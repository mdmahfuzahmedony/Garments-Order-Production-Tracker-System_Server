const express = require('express')
const app = express()
const cors = require("cors")
const port = process.env.PORT || 2001

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.send('Hello World!')
})


const {
  MongoClient,
  ServerApiVersion,
  ObjectId
} = require('mongodb');
const uri = "mongodb+srv://Garments-order-system:ltx60bhXiHK8dSMG@cluster0.awjlwox.mongodb.net/?appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {

  try {

    //collection
    const db = client.db("Garments-order-System")
    const GarmentsCollection = db.collection("Garments-all-product")



    //all garments product

    app.get(("/garments-products"), async (req, res) => {

      const result = await GarmentsCollection.find().toArray();
      res.send(result)

    })

    //all garments product details

    app.get(("/garments-products/:id"), (req, res) => {
      const {
        id
      } = req.params;
      try {
        const result = GarmentsCollection.findOne({
          _id: new ObjectId(id)
        })
        if (result) {
          res.send(result)
        } else {
          res.status(404).send({
            message: "product is not found"
          })
        }

      } catch (error) {
        res.status(500).send({
          message: "server error"
        })

      }


    })







    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({
      ping: 1
    });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}
run().catch(console.dir);



app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})