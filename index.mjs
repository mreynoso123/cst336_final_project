import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEMO_USER_ID = 1;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true
});

app.get('/', (req, res) => {
  res.render('home.ejs');
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

app.post('/watchlist/add', async (req, res) => {
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
      [DEMO_USER_ID, movie_id, title, poster_path, release_date, overview]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Add to watchlist error:', err);
    res.status(500).send('Could not add movie to watchlist.');
  }
});

app.get('/watchlist', async (req, res) => {
  const { status, minRating } = req.query;

  let sql = `SELECT * FROM watchlist WHERE user_id = ?`;
  const params = [DEMO_USER_ID];

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

app.post('/watchlist/update', async (req, res) => {
  const { id, status, user_rating } = req.body;

  try {
    const parsedRating =
      user_rating === '' || user_rating == null ? null : Number(user_rating);

    await pool.query(
      `UPDATE watchlist
       SET status = ?, user_rating = ?
       WHERE id = ? AND user_id = ?`,
      [status, parsedRating, id, DEMO_USER_ID]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Watchlist update error:', err);
    res.status(500).send('Could not update watchlist item.');
  }
});

app.post('/watchlist/delete', async (req, res) => {
  const { id } = req.body;

  try {
    await pool.query(
      `DELETE FROM watchlist WHERE id = ? AND user_id = ?`,
      [id, DEMO_USER_ID]
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