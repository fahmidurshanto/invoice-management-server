require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

const app = express();
const port = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/invoice_app')
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.error(err));

// Vendor Schema
const VendorSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  approved: { type: Boolean, default: false },
  customers: [{ type: String }], // Array of Stripe Customer IDs
  stripeCustomerId: { type: String, required: true },
  subscriptionStatus: { type: String, default: 'trialing' },
  trialEndsAt: { type: Date },
  stripeConnectAccountId: { type: String, default: null },
});

const Vendor = mongoose.model('Vendor', VendorSchema);

// Invoice Schema
const InvoiceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // Stripe Invoice ID
  customerId: { type: String, required: true }, // Stripe Customer ID
  amount: { type: Number, required: true },
  description: { type: String },
  invoiceUrl: { type: String },
  status: { type: String, default: 'open' }, // e.g., 'open', 'paid', 'void', 'uncollectible'
  createdAt: { type: Date, default: Date.now },
});

const Invoice = mongoose.model('Invoice', InvoiceSchema);

// Activity Log Schema
const ActivityLogSchema = new mongoose.Schema({
  eventType: { type: String, required: true }, // e.g., 'vendor_registered', 'vendor_approved', 'invoice_paid', 'fraud_warning'
  description: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  relatedId: { type: String }, // Optional: ID of related entity (e.g., vendorId, invoiceId)
});

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token; // Read token from cookie

  if (token == null) return res.sendStatus(401); // No token

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', err);
      return res.sendStatus(403); // Invalid token
    }
    req.user = user;
    next();
  });
};

app.use(cors({
  origin: 'https://invoice-management-client-id5y.vercel.app',
  credentials: true,
}));
app.use(bodyParser.json());
app.use(cookieParser());

// Remove in-memory storage
// let vendors = []; 
// let invoices = [];

app.get('/', (req, res) => {
  res.send('Invoice Management Server is running!');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    // Check if vendor already exists
    const existingVendor = await Vendor.findOne({ username });
    if (existingVendor) {
      return res.status(409).json({ message: 'Vendor with this username already exists.' });
    }

    // Create a Stripe customer for the new vendor
    const stripeCustomer = await stripe.customers.create({
      email: username, // Use username directly as email
      name: username,
      description: `Vendor: ${username}`,
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newVendor = new Vendor({
      username,
      password: hashedPassword,
      approved: false,
      customers: [],
      stripeCustomerId: stripeCustomer.id,
      subscriptionStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      stripeConnectAccountId: null,
    });

    await newVendor.save();
    console.log('New vendor registered:', newVendor);

    // Log activity
    await ActivityLog.create({
      eventType: 'vendor_registered',
      description: `New vendor registered: ${username}`,
      relatedId: newVendor._id,
    });

    res.status(201).json({ message: 'Vendor registered successfully. Awaiting admin approval.' });
  } catch (error) {
    console.error('Error during vendor registration:', error);
    res.status(500).json({ message: 'Failed to register vendor.', error: error.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log(`Login attempt for username: ${username}, password: ${password}`);

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, vendor.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (!vendor.approved) {
      return res.status(403).json({ message: 'Your account is awaiting admin approval.' });
    }

    const token = jwt.sign(
      { username: vendor.username, role: 'vendor' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' });
    res.status(200).json({ message: 'Login successful!', vendor: { username: vendor.username, approved: vendor.approved, role: 'vendor', subscriptionStatus: vendor.subscriptionStatus, trialEndsAt: vendor.trialEndsAt } });
  } catch (error) {
    console.error('Error during vendor login:', error);
    res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

// Admin Login (for demonstration purposes, hardcoded credentials)
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`Admin Login attempt for username: ${username}, password: ${password}`);

  if (username === 'admin' && password === 'adminpass') {
    const token = jwt.sign(
      { username: 'admin', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' });
    res.status(200).json({ message: 'Admin login successful!', user: { username: 'admin', role: 'admin' } });
  } else {
    res.status(401).json({ message: 'Invalid admin credentials.' });
  }
});

// Admin: Get pending vendors
app.get('/admin/vendors/pending', authenticateToken, async (req, res) => {
  try {
    const pendingVendors = await Vendor.find({ approved: false });
    res.status(200).json(pendingVendors);
  } catch (error) {
    console.error('Error fetching pending vendors:', error);
    res.status(500).json({ message: 'Failed to fetch pending vendors.', error: error.message });
  }
});

// Admin: Approve a vendor
app.post('/admin/vendors/approve', authenticateToken, async (req, res) => {
  const { username } = req.body;
  try {
    const vendor = await Vendor.findOneAndUpdate({ username }, { approved: true }, { new: true });

    if (vendor) {
      // Log activity
      await ActivityLog.create({
        eventType: 'vendor_approved',
        description: `Vendor approved: ${username}`,
        relatedId: vendor._id,
      });
      res.status(200).json({ message: `Vendor ${username} approved successfully.` });
    } else {
      res.status(404).json({ message: 'Vendor not found.' });
    }
  } catch (error) {
    console.error('Error approving vendor:', error);
    res.status(500).json({ message: 'Failed to approve vendor.', error: error.message });
  }
});

// Create a Stripe Customer
app.post('/create-customer', async (req, res) => {
  const { email, name, phone } = req.body;

  try {
    const customer = await stripe.customers.create({
      email,
      name,
      phone,
    });

    // Log activity
    await ActivityLog.create({
      eventType: 'customer_added',
      description: `New customer added: ${name} (${email})`,
      relatedId: customer.id,
    });

    res.status(201).json({ message: 'Stripe customer created successfully.', customerId: customer.id });
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    res.status(500).json({ message: 'Failed to create Stripe customer.', error: error.message });
  }
});

// Create SetupIntent for saving card details
app.post('/create-setup-intent', async (req, res) => {
  const { customerId } = req.body;

  try {
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
    res.status(200).json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    console.error('Error creating SetupIntent:', error);
    res.status(500).json({ message: 'Failed to create SetupIntent.', error: error.message });
  }
});

// Associate a Stripe Customer with a Vendor
app.post('/vendor/add-customer', authenticateToken, async (req, res) => {
  const { vendorUsername, customerId } = req.body;

  try {
    const vendor = await Vendor.findOne({ username: vendorUsername });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    if (!vendor.customers.includes(customerId)) {
      vendor.customers.push(customerId);
      await vendor.save();
      res.status(200).json({ message: 'Customer associated with vendor successfully.' });
    } else {
      res.status(409).json({ message: 'Customer already associated with this vendor.' });
    }
  } catch (error) {
    console.error('Error associating customer with vendor:', error);
    res.status(500).json({ message: 'Failed to associate customer with vendor.', error: error.message });
  }
});

// Get customers for a specific vendor
app.get('/vendor/customers/:username', authenticateToken, async (req, res) => {
  const { username } = req.params;
  try {
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    const enrichedCustomers = await Promise.all(vendor.customers.map(async (customerId) => {
      try {
        const stripeCustomer = await stripe.customers.retrieve(customerId);
        const lastInvoices = await stripe.invoices.list({
          customer: customerId,
          limit: 1,
          status: 'paid',
          expand: ['charge'], // Expand the charge object to get more details if needed
        });

        const lastInvoice = lastInvoices.data.length > 0 ? lastInvoices.data[0] : null;

        return {
          id: stripeCustomer.id,
          name: stripeCustomer.name,
          email: stripeCustomer.email,
          phone: stripeCustomer.phone,
          lastInvoice: lastInvoice ? {
            id: lastInvoice.id,
            amount: lastInvoice.amount_due / 100,
            currency: lastInvoice.currency.toUpperCase(),
            date: new Date(lastInvoice.created * 1000).toLocaleDateString(),
            status: lastInvoice.status,
            url: lastInvoice.hosted_invoice_url,
          } : null,
        };
      } catch (stripeError) {
        console.error(`Error fetching Stripe customer or invoice for ${customerId}:`, stripeError);
        return { id: customerId, name: `Customer ${customerId} (Error)`, email: `error@example.com`, lastInvoice: null };
      }
    }));

    res.status(200).json(enrichedCustomers);
  } catch (error) {
    console.error('Error fetching vendor customers:', error);
    res.status(500).json({ message: 'Failed to fetch vendor customers.', error: error.message });
  }
});

// Create a Payment Intent to charge a customer
app.post('/create-payment-intent', authenticateToken, async (req, res) => {
  const { customerId, amount } = req.body;

  try {
    // Find the default payment method for the customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    if (paymentMethods.data.length === 0) {
      return res.status(400).json({ message: 'No payment method found for this customer.' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // amount in cents
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethods.data[0].id, // Use the first payment method found
      off_session: true, // Indicates that the payment is initiated by the merchant
      confirm: true, // Confirm the payment immediately
    });

    res.status(200).json({ message: 'Payment successful!', paymentIntentId: paymentIntent.id });
  } catch (error) {
    console.error('Error creating Payment Intent:', error);
    res.status(500).json({ message: 'Failed to create Payment Intent.', error: error.message });
  }
});

// Create a Stripe Invoice
app.post('/create-invoice', authenticateToken, async (req, res) => {
  const { customerId, amount, description } = req.body;

  try {
    // Create an invoice item
    const invoiceItem = await stripe.invoiceItems.create({
      customer: customerId,
      amount: amount * 100, // amount in cents
      currency: 'usd',
      description: description,
    });

    // Check if the customer has a default payment method
    const customer = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
    const hasDefaultPaymentMethod = customer.invoice_settings && customer.invoice_settings.default_payment_method;

    let invoice;
    if (hasDefaultPaymentMethod) {
      // Create and finalize the invoice to charge automatically
      invoice = await stripe.invoices.create({
        customer: customerId,
        collection_method: 'charge_automatically',
        auto_advance: true, // Automatically finalizes and attempts collection
      });
      // Immediately finalize the invoice to trigger auto-charge
      invoice = await stripe.invoices.finalizeInvoice(invoice.id);
      res.status(200).json({ message: 'Invoice created and charged automatically!', invoiceId: invoice.id, invoiceUrl: invoice.hosted_invoice_url });
    const newInvoicePaid = new Invoice({ id: invoice.id, customerId, amount, description, invoiceUrl: invoice.hosted_invoice_url, status: 'paid' });
    await newInvoicePaid.save();

    // Log activity
    await ActivityLog.create({
      eventType: 'invoice_created_and_paid',
      description: `Invoice created and automatically paid for customer ${customerId}. Amount: ${amount}`,
      relatedId: invoice.id,
    });

  } else {
    // Create the invoice to be sent manually
    invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 7, // Example: due in 7 days
    });
    res.status(200).json({ message: 'Invoice created successfully (manual send required)!', invoiceId: invoice.id, invoiceUrl: invoice.hosted_invoice_url });
    const newInvoiceOpen = new Invoice({ id: invoice.id, customerId, amount, description, invoiceUrl: invoice.hosted_invoice_url, status: 'open' });
    await newInvoiceOpen.save();

    // Log activity
    await ActivityLog.create({
      eventType: 'invoice_created',
      description: `Invoice created for customer ${customerId}. Amount: ${amount}. Manual send required.`,
      relatedId: invoice.id,
    });

  }

  } catch (error) {
    console.error('Error creating Invoice:', error);
    res.status(500).json({ message: 'Failed to create Invoice.', error: error.message });
  }
});

// Vendor subscribes to a plan
app.post('/vendor/create-subscription', authenticateToken, async (req, res) => {
  const { vendorUsername, paymentMethodId } = req.body;

  try {
    const vendor = await Vendor.findOne({ username: vendorUsername });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(
      paymentMethodId,
      { customer: vendor.stripeCustomerId }
    );

    // Set the default payment method for the customer
    await stripe.customers.update(
      vendor.stripeCustomerId,
      { invoice_settings: { default_payment_method: paymentMethodId } }
    );

    // Create the subscription
    const subscription = await stripe.subscriptions.create({
      customer: vendor.stripeCustomerId,
      items: [{ price: 'price_12345' }], // Replace with your actual Stripe Price ID for $99/month
      expand: ['latest_invoice.payment_intent'],
    });

    // Update vendor's subscription status
    vendor.subscriptionStatus = subscription.status;
    await vendor.save();
    console.log(`Vendor ${vendorUsername} subscribed:`, subscription.status);

    // Log activity
    await ActivityLog.create({
      eventType: 'vendor_subscribed',
      description: `Vendor ${vendorUsername} subscribed to plan. Status: ${subscription.status}`,
      relatedId: vendor._id,
    });

    res.status(200).json({ message: 'Subscription successful!', subscriptionId: subscription.id, vendor: vendor });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: 'Failed to create subscription.', error: error.message });
  }
});

// Request instant payout for vendors using Stripe Express
app.post('/vendor/request-payout', authenticateToken, async (req, res) => {
  const { vendorUsername, amount } = req.body;

  try {
    const vendor = await Vendor.findOne({ username: vendorUsername });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    if (!vendor.stripeConnectAccountId) {
      return res.status(400).json({ message: 'Stripe Express account not connected for this vendor.' });
    }

    const payout = await stripe.payouts.create({
      amount: amount * 100, // amount in cents
      currency: 'usd',
    }, { stripeAccount: vendor.stripeConnectAccountId });

    console.log(`Payout of ${amount} to ${vendor.username} (Stripe Connect Account: ${vendor.stripeConnectAccountId}) initiated. Payout ID: ${payout.id}`);

    // Log activity
    await ActivityLog.create({
      eventType: 'payout_requested',
      description: `Payout of ${amount} requested by ${vendor.username}. Payout ID: ${payout.id}`,
      relatedId: payout.id,
    });

    res.status(200).json({ message: `Payout of ${amount} requested successfully for ${vendor.username}. Payout ID: ${payout.id}` });
  } catch (error) {
    console.error('Error requesting payout:', error);
    res.status(500).json({ message: 'Failed to request payout.', error: error.message });
  }
});

// Stripe Webhook Endpoint for fraud warnings
app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'charge.dispute.created':
      const dispute = event.data.object;
      console.log(`Fraud warning: Dispute created for charge ${dispute.charge}.`);
      // Implement auto-refund logic here
      try {
        await stripe.refunds.create({ charge: dispute.charge });
        console.log(`Auto-refund initiated for charge ${dispute.charge}.`);
        // Simulate admin email notification
        console.log(`ADMIN NOTIFICATION: Fraud warning for charge ${dispute.charge}. Auto-refund initiated.`);

        // Log activity
        await ActivityLog.create({
          eventType: 'fraud_warning_refund',
          description: `Fraud warning: Dispute created for charge ${dispute.charge}. Auto-refund initiated.`,
          relatedId: dispute.charge,
        });

      } catch (refundError) {
        console.error(`Error initiating auto-refund for charge ${dispute.charge}:`, refundError);
        console.log(`ADMIN NOTIFICATION: Fraud warning for charge ${dispute.charge}. Auto-refund FAILED.`);

        // Log activity
        await ActivityLog.create({
          eventType: 'fraud_warning_refund_failed',
          description: `Fraud warning: Dispute created for charge ${dispute.charge}. Auto-refund FAILED. Error: ${refundError.message}`,
          relatedId: dispute.charge,
        });
      }
      break;
    case 'customer.subscription.updated':
      const subscription = event.data.object;
      const stripeCustomerId = subscription.customer;
      const newStatus = subscription.status;
      console.log(`Subscription updated for customer ${stripeCustomerId}. New status: ${newStatus}`);
      try {
        const vendor = await Vendor.findOneAndUpdate(
          { stripeCustomerId: stripeCustomerId },
          { subscriptionStatus: newStatus },
          { new: true }
        );
        if (vendor) {
          console.log(`Vendor ${vendor.username} subscription status updated to ${newStatus}.`);
          // Log activity
          await ActivityLog.create({
            eventType: 'subscription_status_updated',
            description: `Vendor ${vendor.username} subscription status updated to ${newStatus}.`,
            relatedId: vendor._id,
          });
        } else {
          console.log(`Vendor not found for Stripe Customer ID: ${stripeCustomerId}.`);
        }
      } catch (updateError) {
        console.error(`Error updating vendor subscription status:`, updateError);
      }
      break;
    case 'invoice.payment_succeeded':
      const paidInvoice = event.data.object;
      console.log(`Invoice payment succeeded for invoice ID: ${paidInvoice.id}`);
      try {
        const updatedInvoice = await Invoice.findOneAndUpdate(
          { id: paidInvoice.id },
          { status: 'paid' },
          { new: true }
        );
        if (updatedInvoice) {
          console.log(`Invoice ${updatedInvoice.id} status updated to paid.`);
          // Log activity
          await ActivityLog.create({
            eventType: 'invoice_paid',
            description: `Invoice ${updatedInvoice.id} paid successfully.`,
            relatedId: updatedInvoice._id,
          });
        } else {
          console.log(`Invoice not found for ID: ${paidInvoice.id}.`);
        }
      } catch (updateError) {
        console.error(`Error updating invoice status:`, updateError);
      }
      break;
    break;
    case 'payout.succeeded':
      const succeededPayout = event.data.object;
      console.log(`Payout succeeded for ID: ${succeededPayout.id}.`);
      await ActivityLog.create({
        eventType: 'payout_succeeded',
        description: `Payout succeeded for ID: ${succeededPayout.id}. Amount: ${succeededPayout.amount / 100} ${succeededPayout.currency.toUpperCase()}.`,
        relatedId: succeededPayout.id,
      });
      break;
    case 'payout.failed':
      const failedPayout = event.data.object;
      console.log(`Payout failed for ID: ${failedPayout.id}. Reason: ${failedPayout.failure_code || 'N/A'}.`);
      await ActivityLog.create({
        eventType: 'payout_failed',
        description: `Payout failed for ID: ${failedPayout.id}. Reason: ${failedPayout.failure_code || 'N/A'}.`,
        relatedId: failedPayout.id,
      });
      break;
    case 'charge.refunded':
      const refundedCharge = event.data.object;
      console.log(`Charge refunded for ID: ${refundedCharge.id}.`);
      await ActivityLog.create({
        eventType: 'charge_refunded',
        description: `Charge refunded for ID: ${refundedCharge.id}. Amount: ${refundedCharge.amount_refunded / 100} ${refundedCharge.currency.toUpperCase()}.`,
        relatedId: refundedCharge.id,
      });
      break;
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({ received: true });
});

// Admin: Get all vendors
app.get('/admin/vendors/all', authenticateToken, async (req, res) => {
  try {
    const { search, approved, subscriptionStatus } = req.query;
    const query = {};

    if (search) {
      query.username = { $regex: search, $options: 'i' }; // Case-insensitive search
    }
    if (approved !== undefined) {
      query.approved = approved === 'true';
    }
    if (subscriptionStatus) {
      query.subscriptionStatus = subscriptionStatus;
    }

    const allVendors = await Vendor.find(query);
    res.status(200).json(allVendors.map(vendor => ({
      username: vendor.username,
      approved: vendor.approved,
      subscriptionStatus: vendor.subscriptionStatus,
      trialEndsAt: vendor.trialEndsAt,
      stripeCustomerId: vendor.stripeCustomerId,
    })));
  } catch (error) {
    console.error('Error fetching all vendors:', error);
    res.status(500).json({ message: 'Failed to fetch all vendors.', error: error.message });
  }
});

// Admin: Get analytics
app.get('/admin/analytics', authenticateToken, async (req, res) => {
  try {
    const totalVendors = await Vendor.countDocuments({});
    const approvedVendors = await Vendor.countDocuments({ approved: true });
    const trialingVendors = await Vendor.countDocuments({ subscriptionStatus: 'trialing' });

    res.status(200).json({
      totalVendors,
      approvedVendors,
      trialingVendors,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ message: 'Failed to fetch analytics.', error: error.message });
  }
});

// Vendor: Get invoices for their customers
app.get('/vendor/invoices/:vendorUsername', async (req, res) => {
  const { vendorUsername } = req.params;
  try {
    const vendor = await Vendor.findOne({ username: vendorUsername });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    const vendorCustomerIds = vendor.customers;
    const vendorInvoices = await Invoice.find({ customerId: { $in: vendorCustomerIds } });

    res.status(200).json(vendorInvoices);
  } catch (error) {
    console.error('Error fetching vendor invoices:', error);
    res.status(500).json({ message: 'Failed to fetch vendor invoices.', error: error.message });
  }
});

// Admin: Get activity log
app.get('/admin/activity-log', authenticateToken, async (req, res) => {
  try {
    // Ensure only admins can access this log
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admins only.' });
    }

    const { search, eventType } = req.query;
    const query = {};

    if (search) {
      query.description = { $regex: search, $options: 'i' }; // Case-insensitive search
    }
    if (eventType) {
      query.eventType = eventType;
    }

    const activityLogs = await ActivityLog.find(query).sort({ timestamp: -1 }); // Sort by newest first
    res.status(200).json(activityLogs);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ message: 'Failed to fetch activity logs.', error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});

// Vendor: Create Stripe Connect Account Link
app.post('/vendor/create-stripe-connect-account', authenticateToken, async (req, res) => {
  const { vendorUsername } = req.body;

  try {
    const vendor = await Vendor.findOne({ username: vendorUsername });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US', // Or your desired country
      email: vendorUsername, // Use vendorUsername directly as email
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'http://localhost:5173/dashboard', // Redirect back to dashboard on refresh
      return_url: 'http://localhost:5173/stripe-connect-success', // Redirect to success page on completion
      type: 'account_onboarding',
    });

    // Save the Stripe Connect Account ID to the vendor
    vendor.stripeConnectAccountId = account.id;
    await vendor.save();

    res.status(200).json({ url: accountLink.url, vendor: vendor });
  } catch (error) {
    console.error('Error creating Stripe Connect account link:', error);
    res.status(500).json({ message: 'Failed to create Stripe Connect account link.', error: error.message });
  }
});

// Customer: Get invoices for a specific customer
app.get('/customer/invoices/:customerId', authenticateToken, async (req, res) => {
  const { customerId } = req.params;
  try {
    const customerInvoices = await Invoice.find({ customerId });
    res.status(200).json(customerInvoices);
  } catch (error) {
    console.error('Error fetching customer invoices:', error);
    res.status(500).json({ message: 'Failed to fetch customer invoices.', error: error.message });
  }
});

// Vendor: Get current authenticated user's data
app.get('/vendor/get-current-user', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    res.status(200).json({ vendor: { username: vendor.username, approved: vendor.approved, role: 'vendor', subscriptionStatus: vendor.subscriptionStatus, trialEndsAt: vendor.trialEndsAt, stripeConnectAccountId: vendor.stripeConnectAccountId } });
  } catch (error) {
    console.error('Error fetching current vendor data:', error);
    res.status(500).json({ message: 'Failed to fetch current vendor data.', error: error.message });
  }
});

// Vendor: Create SetupIntent for subscription payment method
app.post('/vendor/create-subscription-setup-intent', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    if (!vendor.stripeCustomerId) {
      return res.status(400).json({ message: 'Stripe Customer ID not found for this vendor.' });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: vendor.stripeCustomerId,
      payment_method_types: ['card'],
    });

    res.status(200).json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    console.error('Error creating subscription SetupIntent:', error);
    res.status(500).json({ message: 'Failed to create subscription SetupIntent.', error: error.message });
  }
});

// Admin: Get details for a specific vendor
app.get('/admin/vendor-details/:username', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admins only.' });
    }

    const { username } = req.params;
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    const vendorCustomers = await Promise.all(vendor.customers.map(async (customerId) => {
      // In a real app, you'd fetch full customer details from Stripe
      return { id: customerId, name: `Customer ${customerId}`, email: `customer${customerId}@example.com` };
    }));

    const vendorInvoices = await Invoice.find({ customerId: { $in: vendor.customers } });

    res.status(200).json({
      username: vendor.username,
      approved: vendor.approved,
      subscriptionStatus: vendor.subscriptionStatus,
      trialEndsAt: vendor.trialEndsAt,
      stripeCustomerId: vendor.stripeCustomerId,
      stripeConnectAccountId: vendor.stripeConnectAccountId,
      customers: vendorCustomers,
      invoices: vendorInvoices,
    });
  } catch (error) {
    console.error('Error fetching vendor details:', error);
    res.status(500).json({ message: 'Failed to fetch vendor details.', error: error.message });
  }
});

// Check authentication status
app.get('/check-auth', authenticateToken, async (req, res) => {
  try {
    // req.user is populated by authenticateToken middleware
    const username = req.user.username;
    const role = req.user.role;

    if (role === 'admin') {
      return res.status(200).json({ user: { username, role } });
    } else if (role === 'vendor') {
      const vendor = await Vendor.findOne({ username });
      if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found.' });
      }
      return res.status(200).json({ user: { username: vendor.username, approved: vendor.approved, role: 'vendor', subscriptionStatus: vendor.subscriptionStatus, trialEndsAt: vendor.trialEndsAt, stripeConnectAccountId: vendor.stripeConnectAccountId } });
    }
    res.status(400).json({ message: 'Invalid user role.' });
  } catch (error) {
    console.error('Error checking auth:', error);
    res.status(500).json({ message: 'Failed to check authentication status.', error: error.message });
  }
});

// Logout endpoint
app.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' });
  res.status(200).json({ message: 'Logged out successfully.' });
});

// Generate customer invite link
app.post('/customer/generate-invite-link', (req, res) => {
  const { customerId } = req.body;
  if (!customerId) {
    return res.status(400).json({ message: 'Customer ID is required.' });
  }
  const inviteLink = `http://localhost:5173/customer/dashboard/${customerId}`;
  res.status(200).json({ inviteLink });
});

// Vendor: Get payout history
app.get('/vendor/payout-history', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    if (!vendor.stripeConnectAccountId) {
      return res.status(400).json({ message: 'Stripe Express account not connected for this vendor.' });
    }

    const payouts = await stripe.payouts.list(
      { limit: 10 }, // Fetch last 10 payouts
      { stripeAccount: vendor.stripeConnectAccountId }
    );

    res.status(200).json(payouts.data);
  } catch (error) {
    console.error('Error fetching payout history:', error);
    res.status(500).json({ message: 'Failed to fetch payout history.', error: error.message });
  }
});

// Vendor: Cancel subscription
app.post('/vendor/cancel-subscription', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const vendor = await Vendor.findOne({ username });

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    // Retrieve the vendor's current subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: vendor.stripeCustomerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return res.status(400).json({ message: 'No active subscription found for this vendor.' });
    }

    const subscriptionId = subscriptions.data[0].id;

    // Cancel the subscription
    const canceledSubscription = await stripe.subscriptions.cancel(subscriptionId);

    // Update vendor's subscription status in DB
    vendor.subscriptionStatus = canceledSubscription.status;
    await vendor.save();

    // Log activity
    await ActivityLog.create({
      eventType: 'subscription_canceled',
      description: `Vendor ${username} canceled subscription. Status: ${canceledSubscription.status}`,
      relatedId: vendor._id,
    });

    res.status(200).json({ message: 'Subscription canceled successfully.', vendor: vendor });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ message: 'Failed to cancel subscription.', error: error.message });
  }
});
