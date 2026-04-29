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

const TMDB_GENRES = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

function mapGenreIdsToNames(genreIds = []) {
  if (!Array.isArray(genreIds) || genreIds.length === 0) {
    return '';
  }

  return genreIds
    .map(id => TMDB_GENRES[id])
    .filter(Boolean)
    .join(', ');
}

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
      return res.render('search.ejs', {
        movies: [],
        error: data.status_message || 'Unable to fetch movie results right now.',
        query
      });
    }

    const moviesWithGenres = (data.results || []).map(movie => ({
      ...movie,
      genre_names: mapGenreIdsToNames(movie.genre_ids)
    }));

    res.render('search.ejs', {
      movies: moviesWithGenres,
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
    overview,
    genre
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO movies (movieId, title)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title)`,
      [movie_id, title]
    );

    await pool.query(
      `INSERT INTO watchlist
      (userId, movieId, watchStatus, rating, genre, posterPath, releaseDate, overview)
      VALUES (?, ?, 'Want to Watch', NULL, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        genre = VALUES(genre),
        posterPath = VALUES(posterPath),
        releaseDate = VALUES(releaseDate),
        overview = VALUES(overview)`,
      [DEMO_USER_ID, movie_id, genre, poster_path, release_date, overview]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Add to watchlist error:', err);
    res.status(500).send(`Could not add movie to watchlist: ${err.message}`);
  }
});

app.get('/watchlist', async (req, res) => {
  const { status, genre, minRating } = req.query;

  let sql = `
    SELECT 
      w.watchlistId,
      w.userId,
      w.movieId,
      m.title,
      w.watchStatus,
      w.rating,
      w.genre,
      w.posterPath,
      w.releaseDate,
      w.overview,
      w.createdAt
    FROM watchlist w
    JOIN movies m ON w.movieId = m.movieId
    WHERE w.userId = ?
  `;
  const params = [DEMO_USER_ID];

  if (status) {
    sql += ` AND w.watchStatus = ?`;
    params.push(status);
  }

  if (genre) {
    sql += ` AND w.genre LIKE ?`;
    params.push(`%${genre}%`);
  }

  if (minRating) {
    sql += ` AND w.rating >= ?`;
    params.push(Number(minRating));
  }

  sql += ` ORDER BY w.createdAt DESC`;

  try {
    const [movies] = await pool.query(sql, params);

    const [genres] = await pool.query(
      `SELECT DISTINCT genre
       FROM watchlist
       WHERE userId = ? AND genre IS NOT NULL AND genre != ''`,
      [DEMO_USER_ID]
    );

    const genreOptions = genres
      .flatMap(row => row.genre.split(','))
      .map(g => g.trim())
      .filter(Boolean);

    const uniqueGenreOptions = [...new Set(genreOptions)].sort();

    res.render('watchlist.ejs', {
      movies,
      genreOptions: uniqueGenreOptions,
      filters: {
        status: status || '',
        genre: genre || '',
        minRating: minRating || ''
      }
    });
  } catch (err) {
    console.error('Watchlist fetch error:', err);
    res.status(500).send(`Could not load watchlist: ${err.message}`);
  }
});

app.post('/watchlist/update', async (req, res) => {
  const { id, status, user_rating } = req.body;

  try {
    const parsedRating =
      user_rating === '' || user_rating == null ? null : Number(user_rating);

    await pool.query(
      `UPDATE watchlist
       SET watchStatus = ?, rating = ?
       WHERE watchlistId = ? AND userId = ?`,
      [status, parsedRating, id, DEMO_USER_ID]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Watchlist update error:', err);
    res.status(500).send(`Could not update watchlist item: ${err.message}`);
  }
});

app.post('/watchlist/delete', async (req, res) => {
  const { id } = req.body;

  try {
    await pool.query(
      `DELETE FROM watchlist
       WHERE watchlistId = ? AND userId = ?`,
      [id, DEMO_USER_ID]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Delete watchlist error:', err);
    res.status(500).send(`Could not remove movie: ${err.message}`);
  }
});

app.get('/dbTest', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT CURDATE() AS today');
    res.send(rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).send(`Database error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});