const express = require('express');
const cors = require('cors');
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User.js');
const Place = require('./models/Place.js');
const Booking = require('./models/Booking.js');
const cookieParser = require('cookie-parser');
const imageDownloader = require('image-downloader');
const {S3Client, PutObjectCommand} = require('@aws-sdk/client-s3');
const fs = require('fs');
const mime = require('mime-types');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

require('dotenv').config();
const app = express();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
//databse url


const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = 'fasefraw4r5r3wq45wdfgw34twdfg';
const bucket = 'praveen-booking-app';

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname+'/uploads'));

app.use(cors({
  credentials: true,
  origin: 'https://travel-booking-app-front-end.vercel.app',
}));

const storage = multer.memoryStorage();
const upload = multer({storage:storage});

async function uploadToS3(path, originalFilename, mimetype) {
  const client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  const parts = originalFilename.split('.');
  const ext = parts[parts.length - 1];
  const newFilename = Date.now() + '.' + ext;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Body: fs.readFileSync(path),
    Key: newFilename,
    ContentType: mimetype,
    ACL: 'public-read',
  }));
  return `https://${bucket}.s3.amazonaws.com/${newFilename}`;
}

function getUserDataFromReq(req) {
  return new Promise((resolve, reject) => {
    jwt.verify(req.cookies.token, jwtSecret, {}, async (err, userData) => {
      if (err) throw err;
      resolve(userData);
    });
  });
}

app.get('/api/test', (req,res) => {
  res.json('test ok');
});

app.post('/api/register', async (req,res) => {
  const {name,email,password} = req.body;

  try {
    const userDoc = await User.create({
      name,
      email,
      password:bcrypt.hashSync(password, bcryptSalt),
    });
    res.json(userDoc);
  } catch (e) {
    res.status(422).json(e);
  }

});

app.post('/api/login', async (req,res) => {
  const {email,password} = req.body;
  const userDoc = await User.findOne({email});
  if (userDoc) {
    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (passOk) {
      jwt.sign({
        email:userDoc.email,
        id:userDoc._id
      }, jwtSecret, {}, (err,token) => {
        if (err) throw err;
        res.cookie('token', token).json(userDoc);
      });
    } else {
      res.status(422).json({
        message : "Please enter correct credentials"
      });
    }
  } else {
    res.status(401).json({
      message : "No Such user Found"
    });
  }
});

app.get('/api/profile', (req,res) => {
  const {token} = req.cookies;
  if (token) {
    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
      if (err) throw err;
      const data = await User.findById(userData.id);
      if(data){
        const {name,email,_id} = data;
        return res.json({name,email,_id});
      }
      return res.json({});
    });
  } else {
    res.json(null);
  }
});

app.post('/api/logout', (req,res) => {
  res.cookie('token', '').json(true);
});


// Express route to handle image upload by URL
app.post('/api/upload-by-link', async (req, res) => {
  try {
    const { link } = req.body;

    // Upload the image from the URL directly to Cloudinary
    cloudinary.uploader.upload(link, { folder: 'folder_name' }, (error, result) => {
      if (error) {
        console.error("Error uploading to Cloudinary: ", error);
        return res.status(500).json({ error: 'Error uploading image to Cloudinary' });
      }

      console.log("Uploaded image URL: ", result.secure_url);
      res.json({ imageUrl: result.secure_url });
    });
  } catch (error) {
    console.error("Error in upload handler: ", error);
    res.status(500).json({ error: 'Error uploading image' });
  }
});


// Express route for single image upload
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const fileBuffer = req.file.buffer; // Access buffer directly since using memory storage

    console.log("Received file for upload: ", req.file);

    cloudinary.uploader.upload_stream(
      { folder: 'folder_name' },
      (error, result) => {
        if (error) {
          console.error("Error uploading to Cloudinary: ", error);
          return res.status(500).json({ error: 'Error uploading image to Cloudinary' });
        }
        console.log("Uploaded image URL: ", result.secure_url);
        res.json({ imageUrl: result.secure_url });
      }
    ).end(fileBuffer); // End the stream with file buffer
  } catch (error) {
    console.error("Error in upload handler: ", error);
    res.status(500).json({ error: 'Error uploading image' });
  }
});

app.post('/api/places', (req,res) => {
  const {token} = req.cookies;
  const {
    title,address,addedPhotos,description,price,
    perks,extraInfo,checkIn,checkOut,maxGuests,
  } = req.body;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    if (err) throw err;
    const placeDoc = await Place.create({
      owner:userData.id,price,
      title,address,photos:addedPhotos,description,
      perks,extraInfo,checkIn,checkOut,maxGuests,
    });
    res.json(placeDoc);
  });
});

app.get('/api/user-places', (req,res) => {
  const {token} = req.cookies;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    const {id} = userData;
    res.json( await Place.find({owner:id}) );
  });
});

app.get('/api/places/:id', async (req,res) => {
  const {id} = req.params;
  res.json(await Place.findById(id));
});

app.put('/api/places', async (req,res) => {
  const {token} = req.cookies;
  const {
    id, title,address,addedPhotos,description,
    perks,extraInfo,checkIn,checkOut,maxGuests,price,
  } = req.body;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    if (err) throw err;
    const placeDoc = await Place.findById(id);
    if (userData.id === placeDoc.owner.toString()) {
      placeDoc.set({
        title,address,photos:addedPhotos,description,
        perks,extraInfo,checkIn,checkOut,maxGuests,price,
      });
      await placeDoc.save();
      res.json('ok');
    }
  });
});

app.get('/api/places', async (req,res) => {
  res.json( await Place.find() );
});

app.post('/api/bookings', async (req, res) => {
  const userData = await getUserDataFromReq(req);
  const {
    place,checkIn,checkOut,numberOfGuests,name,phone,price,
  } = req.body;
  Booking.create({
    place,checkIn,checkOut,numberOfGuests,name,phone,price,
    user:userData.id,
  }).then((doc) => {
    res.json(doc);
  }).catch((err) => {
    throw err;
  });
});



app.get('/api/bookings', async (req,res) => {
  const userData = await getUserDataFromReq(req);
  res.json( await Booking.find({user:userData.id}).populate('place') );
});

app.get("/" , (req,res) => {
  res.send("hihihihi");
});

app.post('/api/cancel-booking' , async (req,res) => {
  const {bookingId} = req.body;
  try {
    const response = await Booking.findByIdAndDelete(bookingId);
    return res.status(200).json({
      message : "booking cancelled sucessfully",
      response
    })
  } catch (error) {
    return res.status(500).json({
      message : "internal server occured during cancellation of booking",
      error
    })
  }

});


app.listen(4000 , ()=> {
  mongoose.connect(process.env.DATA_BASE_URL).then(() => {
    console.log("Mongoose connected successfully");
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
  })
  console.log("app running on server 4000");
});