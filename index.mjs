import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// added these imports for user Authentication - Joseph
import session from 'express-session';
import bcrypt from 'bcrypt';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
  
app.use((req, res, next) => {
  res.locals.userName = req.session.userName || null;
  next();
});

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
  res.render('home.ejs');
});

app.get('/signup', (req, res) => {
  res.render('signup.ejs', { error: null });
});

app.get('/login', (req, res) => {
  res.render('login.ejs', { error: null });
});

app.post('/signup', async (req, res) => {
  const { userName, password } = req.body;

  if (!userName || !password) {
    return res.render('signup.ejs', { error: 'All fields are required.' });
  }

  try {
    const [existingUsers] = await pool.query(
      'SELECT userId FROM Users WHERE userName = ?',
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
      'SELECT userId, userName, password FROM Users WHERE userName = ?',
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

    if (!response.ok) {
      console.error('TMDB API error:', data);
      return res.render('search.ejs', {
        movies: [],
        error: data.status_message || 'Unable to fetch movie results right now.',
        query
      });
    }

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

app.post('/watchlist/add', isAuthenticated, async (req, res) => {
  const {
    movie_id,
    title,
    poster_path,
    release_date,
    overview
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO watchlist
      (user_id, movie_id, title, poster_path, release_date, status, user_rating, overview)
      VALUES (?, ?, ?, ?, ?, 'Want to Watch', NULL, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        poster_path = VALUES(poster_path),
        release_date = VALUES(release_date),
        overview = VALUES(overview)`,
      [req.session.userId, movie_id, title, poster_path, release_date, overview]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Add to watchlist error:', err);
    res.status(500).send('Could not add movie to watchlist.');
  }
});

app.get('/watchlist', isAuthenticated, async (req, res) => {
  const { status, minRating } = req.query;

  let sql = `SELECT * FROM watchlist WHERE user_id = ?`;
  const params = [req.session.userId];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  if (minRating) {
    sql += ` AND user_rating >= ?`;
    params.push(Number(minRating));
  }

  sql += ` ORDER BY created_at DESC`;

  try {
    const [movies] = await pool.query(sql, params);

    res.render('watchlist.ejs', {
      movies,
      filters: {
        status: status || '',
        minRating: minRating || ''
      }
    });
  } catch (err) {
    console.error('Watchlist fetch error:', err);
    res.status(500).send('Could not load watchlist.');
  }
});

app.post('/watchlist/update', isAuthenticated, async (req, res) => {
  const { id, status, user_rating } = req.body;

  try {
    const parsedRating =
      user_rating === '' || user_rating == null ? null : Number(user_rating);

    await pool.query(
      `UPDATE watchlist
       SET status = ?, user_rating = ?
       WHERE id = ? AND user_id = ?`,
      [status, parsedRating, id, req.session.userId]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Watchlist update error:', err);
    res.status(500).send('Could not update watchlist item.');
  }
});

app.post('/watchlist/delete', isAuthenticated, async (req, res) => {
  const { id } = req.body;

  try {
    await pool.query(
      `DELETE FROM watchlist WHERE id = ? AND user_id = ?`,
      [id, req.session.userId]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Delete watchlist error:', err);
    res.status(500).send('Could not remove movie.');
  }
});

app.get('/dbTest', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT CURDATE() AS today');
    res.send(rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).send('Database error!');
  }
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});