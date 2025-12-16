const express = require('express');
const cors = require("cors");
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const {
    MongoClient,
    ServerApiVersion,
    ObjectId
} = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 2001;
// যদি env না পায়, তবুও যেন সার্ভার ক্র্যাশ না করে
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// --- MIDDLEWARE ---
app.use(cors({
    origin: [
        'http://localhost:5173', // Localhost Development
        'https://garments-order-production-tracker-s.vercel.app' // Vercel Live Production
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(cookieParser());

// --- MONGODB CONNECTION ---
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.awjlwox.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Collections (Global Scope)
const db = client.db("Garments-order-System");
const GarmentsCollection = db.collection("Garments-all-product");
const booking_list = db.collection("Booking-list");
const usersCollection = db.collection("users");

// Database Connection Function
async function dbConnect() {
    try {
        await client.connect();
        console.log("Database Connected Successfully!");
    } catch (error) {
        console.error("DB Connection Failed:", error);
    }
}
dbConnect();

// --- AUTHENTICATION ---
app.post('/jwt', async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET || 'secret123', {
        expiresIn: '1h'
    });

    // Production Check
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('token', token, {
            httpOnly: true,
            secure: isProduction, // True on Production
            sameSite: isProduction ? 'none' : 'strict' // 'none' on Production
        })
        .send({
            success: true
        });
});

app.post('/logout', async (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('token', {
            maxAge: 0,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'strict'
        })
        .send({
            success: true
        });
});

const verifyToken = (req, res, next) => {
    const token = req.cookies ?.token;
    if (!token) return res.status(401).send({
        message: 'Unauthorized access'
    });
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'secret123', (err, decoded) => {
        if (err) return res.status(401).send({
            message: 'Unauthorized access'
        });
        req.user = decoded;
        next();
    });
};

// --- ROUTES ---

app.get('/', (req, res) => {
    res.send('Server is Running');
});

// --- PUBLIC ROUTES ---
app.get("/garments-products", async (req, res) => {
    const result = await GarmentsCollection.find().toArray();
    res.send(result);
});

app.get("/garments-products/:id", async (req, res) => {
    const id = req.params.id;
    try {
        const query = {
            _id: new ObjectId(id)
        };
        const result = await GarmentsCollection.findOne(query);
        res.send(result);
    } catch (error) {
        res.status(500).send({
            message: "Invalid ID"
        });
    }
});

app.post('/users', async (req, res) => {
    const user = req.body;
    if (!user.role) user.role = 'user';
    if (!user.status) user.status = 'active';

    const query = {
        email: user.email
    };
    const existingUser = await usersCollection.findOne(query);
    if (existingUser) return res.send({
        message: 'User exists',
        insertedId: null
    });

    const result = await usersCollection.insertOne(user);
    res.send(result);
});

// --- USER ROUTES ---
app.get('/users/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    if (req.user.email !== email) return res.status(403).send({
        message: 'forbidden'
    });
    const result = await usersCollection.findOne({
        email
    });
    res.send(result);
});

app.get('/users/admin/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    if (req.user.email !== email) return res.status(403).send({
        message: 'forbidden'
    });
    const user = await usersCollection.findOne({
        email
    });
    res.send({
        admin: user ?.role === 'admin'
    });
});

app.get('/users/manager/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    if (req.user.email !== email) return res.status(403).send({
        message: 'forbidden'
    });
    const user = await usersCollection.findOne({
        email
    });
    res.send({
        manager: user ?.role === 'manager'
    });
});

// --- BOOKING ROUTES ---
app.post('/bookings', verifyToken, async (req, res) => {
    try {
        const booking = req.body;
        const query = {
            _id: new ObjectId(booking.productId)
        };
        const product = await GarmentsCollection.findOne(query);

        if (!product || (product.availableQuantity || product.quantity) < booking.quantity) {
            return res.send({
                error: true,
                message: "Stock not available"
            });
        }

        booking.orderDate = new Date();
        booking.status = 'Pending';
        booking.paymentStatus = 'Unpaid';

        booking.trackingHistory = [{
            status: 'Order Placed',
            note: 'Order received successfully',
            date: new Date(),
            location: 'System'
        }];

        const result = await booking_list.insertOne(booking);
        if (result.insertedId) {
            await GarmentsCollection.updateOne(query, {
                $inc: {
                    availableQuantity: -parseInt(booking.quantity)
                }
            });
        }
        res.send(result);
    } catch (error) {
        res.status(500).send({
            error: true,
            message: error.message
        });
    }
});

app.get('/bookings', verifyToken, async (req, res) => {
    const email = req.query.email;
    if (req.user.email !== email) return res.status(403).send({
        message: 'forbidden'
    });
    const result = await booking_list.find({
        userEmail: email
    }).sort({
        orderDate: -1
    }).toArray();
    res.send(result);
});

app.get('/bookings/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const result = await booking_list.findOne({
        _id: new ObjectId(id)
    });
    res.send(result);
});

app.delete('/bookings/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const result = await booking_list.deleteOne({
        _id: new ObjectId(id)
    });
    res.send(result);
});

// --- MANAGER ROUTES ---
app.get('/bookings/manager/pending/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    const managerProducts = await GarmentsCollection.find({
        managerEmail: email
    }).toArray();
    const productIds = managerProducts.map(p => p._id.toString());
    const query = {
        productId: {
            $in: productIds
        },
        $or: [{
            status: 'Pending'
        }, {
            status: null
        }]
    };
    const result = await booking_list.find(query).toArray();
    res.send(result);
});

app.get('/bookings/manager/approved/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    const managerProducts = await GarmentsCollection.find({
        managerEmail: email
    }).toArray();
    const productIds = managerProducts.map(p => p._id.toString());
    const query = {
        productId: {
            $in: productIds
        },
        status: {
            $ne: 'Pending'
        }
    };
    const result = await booking_list.find(query).sort({
        approvedAt: -1
    }).toArray();
    res.send(result);
});

// --- STATUS & TRACKING UPDATE ROUTES ---

app.patch('/bookings/status/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const {
        status
    } = req.body;
    let updateDoc = {
        $set: {
            status: status
        },
        $push: {
            trackingHistory: {
                status: status,
                note: status === 'Approved' ? 'Manager approved the order' : 'Order rejected',
                date: new Date(),
                location: 'Manager Dashboard'
            }
        }
    };
    if (status === 'Approved') updateDoc.$set.approvedAt = new Date();

    const result = await booking_list.updateOne({
        _id: new ObjectId(id)
    }, updateDoc);
    res.send(result);
});

app.put('/bookings/tracking/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const {
        status,
        note,
        location
    } = req.body;

    const filter = {
        _id: new ObjectId(id)
    };
    const trackingInfo = {
        status,
        note,
        location,
        date: new Date()
    };

    const updateDoc = {
        $set: {
            status: status
        },
        $push: {
            trackingHistory: trackingInfo
        }
    };

    const result = await booking_list.updateOne(filter, updateDoc);
    res.send(result);
});

// --- PRODUCT MANAGEMENT ---
app.post('/garments-products', verifyToken, async (req, res) => {
    const result = await GarmentsCollection.insertOne(req.body);
    res.send(result);
});

app.put('/garments-products/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const filter = {
        _id: new ObjectId(id)
    };
    const {
        _id,
        ...updatedData
    } = req.body;
    const result = await GarmentsCollection.updateOne(filter, {
        $set: updatedData
    });
    res.send(result);
});

app.get('/garments-products/manager/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    if (req.user.email !== email) return res.status(403).send({
        message: 'forbidden'
    });
    const result = await GarmentsCollection.find({
        managerEmail: email
    }).toArray();
    res.send(result);
});

app.delete('/garments-products/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const result = await GarmentsCollection.deleteOne({
        _id: new ObjectId(id)
    });
    res.send(result);
});

// ADMIN: GET ALL ORDERS
app.get('/all-orders', verifyToken, async (req, res) => {
    try {
        const result = await booking_list.find().sort({
            orderDate: -1
        }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({
            message: error.message
        });
    }
});

// TOGGLE HOME STATUS
app.patch('/garments-products/home-status/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const {
        showOnHome
    } = req.body;
    const filter = {
        _id: new ObjectId(id)
    };
    const updateDoc = {
        $set: {
            showOnHome: showOnHome
        }
    };
    const result = await GarmentsCollection.updateOne(filter, updateDoc);
    res.send(result);
});

// --- ADMIN ROUTES ---
app.get('/users', verifyToken, async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
});

app.patch('/users/update/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const {
        role,
        status
    } = req.body;
    const filter = {
        _id: new ObjectId(id)
    };
    let updateDoc = {
        $set: {
            status: status
        }
    };
    if (role) updateDoc.$set.role = role;
    const result = await usersCollection.updateOne(filter, updateDoc);
    res.send(result);
});

// --- PAYMENT ---
app.post('/create-checkout-session', verifyToken, async (req, res) => {
    try {
        const {
            productName,
            price,
            orderId,
            image
        } = req.body;
        const amount = Math.round(price * 100);

        // 🔥 লাইভ লিংক এখানে সেট করা হয়েছে (Fixed) 🔥
        const clientUrl = 'https://garments-order-production-tracker-s-nu.vercel.app';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: productName,
                        images: [image]
                    },
                    unit_amount: amount,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${clientUrl}/dashboard/payment/success/${orderId}?transactionId={CHECKOUT_SESSION_ID}`,
            cancel_url: `${clientUrl}/dashboard/my-orders`,
        });
        res.send({
            url: session.url
        });
    } catch (error) {
        res.status(500).send({
            error: true,
            message: error.message
        });
    }
});

app.patch('/bookings/payment-success/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const {
        transactionId
    } = req.body;
    const result = await booking_list.updateOne({
        _id: new ObjectId(id)
    }, {
        $set: {
            paymentStatus: 'Paid',
            transactionId,
            status: 'Pending'
        }
    });
    res.send(result);
});

// Server Listen
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});