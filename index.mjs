import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// added these imports for user Authentication - Joseph
import session from 'express-session';
import bcrypt from 'bcrypt';

dotenv.config();

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));
// for Express to get values using the POST method
app.use(express.urlencoded({ extended: true }));

// added session middleware for user authentication - Joseph
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

// routes
app.get('/', (req, res) => {
  res.render('home.ejs', { userName: req.session.userName || null });
});

app.get('/watchlist', isAuthenticated, (req, res) => {
  res.send('Protected page');
});

app.get('/signup', (req, res) => {
  res.render('signup.ejs', { error: null });
});

app.get('/login', (req, res) => {
  res.render('login.ejs', { error: null });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/search', async (req, res) => {
  const query = req.query.query?.trim();

  if (!query) {
    return res.render('search.ejs', {
      movies: [],
      error: 'Please enter a movie title.',
      query: ''
    });
  }
  

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

app.post('/signup', async (req, res) => {
  const { userName, password } = req.body;

  if (!userName || !password) {
    return res.render('signup.ejs', { error: 'All fields are required.' });
  }

  try {
    const [existingUsers] = await pool.query(
      'SELECT * FROM Users WHERE userName = ?',
      [userName]
    );

    if (existingUsers.length > 0) {
      return res.render('signup.ejs', { error: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO Users (userName, password) VALUES (?, ?)',
      [userName, hashedPassword]
    );

    res.redirect('/login');
  } catch (err) {
    console.error('Signup error:', err);
    res.render('signup.ejs', { error: 'Error creating account.' });
  }
});

app.post('/login', async (req, res) => {
  const { userName, password } = req.body;

  if (!userName || !password) {
    return res.render('login.ejs', { error: 'All fields are required.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT * FROM Users WHERE userName = ?',
      [userName]
    );

    if (rows.length === 0) {
      return res.render('login.ejs', { error: 'Invalid username or password.' });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.render('login.ejs', { error: 'Invalid username or password.' });
    }

    req.session.userId = user.userId;
    req.session.userName = user.userName;

    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login.ejs', { error: 'Login failed.' });
  }
});

app.get('/dbTest', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT CURDATE()');
    res.send(rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).send('Database error!');
  }
});

app.listen(3000, () => {
  console.log('Express server running');
});