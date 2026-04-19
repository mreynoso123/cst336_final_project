import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

//added these imports for user Authentication - Joseph
import session from 'express-session';
import bcrypt from 'bcrypt';

dotenv.config();

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));
//for Express to get values using the POST method
app.use(express.urlencoded({extended:true}));
//setting up database connection pool, replace values in red

//added session middleware for user authentication - Joseph
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretkey',
  resave: false,
  saveUninitialized: false
}));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true
});

// middleware to check if user is authenticated - Joseph
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}
app.get('/watchlist', isAuthenticated, (req, res) => {
  res.send('Protected page');
});

//routes
app.get('/', (req, res) => {
   res.render('home.ejs')
});

/* app.get('/search', (req, res) => {


   res.render('search.ejs')
}); */

app.get('/search', async (req, res) => {
  const query = req.query.query?.trim();
  if (!query) {
    return res.render('search.ejs', {
      movies: [],
      error: 'Please enter a movie title.'
    });
  }


//added routes for user authentication - Joseph
app.get('/signup', (req, res) => {
  res.render('signup.ejs', { error: null });
});

// app.post('/signup', async (req, res) => {
//   ...
// });

app.get('/login', (req, res) => {
  res.render('login.ejs', { error: null });
});

// app.post('/login', async (req, res) => {
//   ...
// });

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    const data = await response.json();
    console.log(data);

    res.render('search.ejs', {
      movies: data.results || [],
      error: null,
      query
    });
  } catch (err) {
    console.error('TMDB error:', err);
    res.render('search.ejs', {
      movies: [],
      error: 'Unable to fetch movie results right now.',
      query
    });
  }
});

app.get("/dbTest", async(req, res) => {
   try {
        const [rows] = await pool.query("SELECT CURDATE()");
        res.send(rows);
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).send("Database error!");
    }
});//dbTest
app.listen(3000, ()=>{
    console.log("Express server running")
})
