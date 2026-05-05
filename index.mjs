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

function isAuthenticated(req, res, next) {
  if (req.session?.userId) {
    return next();
  }

  return res.redirect('/login');
}

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

app.get('/signup', (req, res) => {
  res.render('signup.ejs', { error: null });
});

app.get('/login', (req, res) => {
  res.render('login.ejs', { error: null });
});

app.get('/profile', isAuthenticated, async (req, res) => {
  const userId = req.session.userId;

  try {
    const [userRows] = await pool.query(
      'SELECT * FROM Users WHERE userId = ?',
      [userId]
    );

    const [watchlistInfo] = await pool.query(
      'SELECT * FROM watchlist WHERE userId = ?',
      [userId]
    );

    const userInfo = userRows[0];

    const totalWatchlists = watchlistInfo.length;
    const watchedCount = watchlistInfo.filter(
      item => item.watchStatus === 'Watched'
    ).length;
    const ratedCount = watchlistInfo.filter(
      item => item.rating !== null
    ).length;

    res.render('profile.ejs', {
      userInfo,
      watchlistInfo,
      totalWatchlists,
      watchedCount,
      ratedCount
    });
  } catch (err) {
    console.error('Profile summary error:', err);
    res.redirect('/');
  }
});

app.get('/updateProfile', isAuthenticated, async (req, res) => {
  let userId = req.session.userId;

  let sql = `SELECT * FROM Users WHERE userId = ?`;
  const [userRows] = await pool.query(sql, [userId]);
  let userInfo = userRows[0];
  let watchlistSql = `SELECT * FROM watchlist WHERE userId = ?`;
  const [watchlistInfo] = await pool.query(watchlistSql, [userId]);

  res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: null });
});

app.post('/updateProfile', isAuthenticated, async (req, res) => {
  let { userName, password } = req.body;
  let userId = req.session.userId;
  let action = req.body.action;

  let sqlUser = `SELECT * FROM Users WHERE userId = ?`;
  let sqlWatchlist = `SELECT * FROM watchlist WHERE userId = ?`;

  // update user
  if (action === 'updateUser') {
    // check if userName or password is empty
    if (!userName?.trim() || !password?.trim()) {
      const [userRows] = await pool.query(sqlUser, [userId]);
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      let userInfo = userRows[0];
      return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'All fields are required.' });
    }

    try {
      const [existingUsers] = await pool.query(
        // check if userName already exists and is not the same user
        'SELECT userId FROM Users WHERE userName = ? AND userId <> ?',
        [userName, userId]
      );
      if (existingUsers.length > 0) {
        const [userRows] = await pool.query(sqlUser, [userId]);
        let userInfo = userRows[0];
        const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
        return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Username already exists.' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE Users SET userName = ?, password = ? WHERE userId = ?',
        [userName, hashedPassword, userId]
      );
      res.redirect('/updateProfile');
    } catch (err) {
      console.error('Update profile error:', err);
      const [userRows] = await pool.query(sqlUser, [userId]);
      let userInfo = userRows[0];
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Error updating profile.' });
    }
  } 
  // update watchlist
  else if (action === 'updateWatchlist') {
    let { watchlistId, watchlistName } = req.body;
    if (!watchlistName?.trim()) {
      const [userRows] = await pool.query(sqlUser, [userId]);
      let userInfo = userRows[0];
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Watchlist name is required.' });
    }
    try {
      const trimmedWatchlistName = watchlistName.trim();
      const [existingWatchlists] = await pool.query(
        'SELECT watchlistId FROM watchlist WHERE userId = ? AND watchlistName = ? AND watchlistId <> ?',
        [userId, trimmedWatchlistName, watchlistId]
      );
      if (existingWatchlists.length > 0) {
        const [userRows] = await pool.query(sqlUser, [userId]);
        let userInfo = userRows[0];
        const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
        return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'You already have a watchlist with that name.' });
      }

      await pool.query(
        'UPDATE watchlist SET watchlistName = ? WHERE watchlistId = ? AND userId = ?',
        [trimmedWatchlistName, watchlistId, userId]
      );
      res.redirect('/updateProfile');
    } catch (err) {
      console.error('Update watchlist error:', err);
      const [userRows] = await pool.query(sqlUser, [userId]);
      let userInfo = userRows[0];
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Error updating watchlist.' });
    }
  } 
  // create watchlist
  else if (action === 'createWatchlist') {
    let { watchlistName } = req.body;
    if (!watchlistName?.trim()) {
      const [userRows] = await pool.query(sqlUser, [userId]);
      let userInfo = userRows[0];
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Watchlist name is required.' });
    }
    try {
      const trimmedWatchlistName = watchlistName.trim();
      const [existingWatchlists] = await pool.query(
        'SELECT watchlistId FROM watchlist WHERE userId = ? AND watchlistName = ?',
        [userId, trimmedWatchlistName]
      );
      if (existingWatchlists.length > 0) {
        const [userRows] = await pool.query(sqlUser, [userId]);
        let userInfo = userRows[0];
        const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
        return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'You already have a watchlist with that name.' });
      }

      await pool.query(
        'INSERT INTO watchlist (watchlistName, userId) VALUES (?, ?)',
        [trimmedWatchlistName, userId]
      );
      res.redirect('/updateProfile');
    } catch (err) {
      console.error('Create watchlist error:', err);
      const [userRows] = await pool.query(sqlUser, [userId]);
      let userInfo = userRows[0];
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Error creating watchlist.' });
    }
  } 
  // delete watchlist
  else if (action === 'deleteWatchlist') {
    let { watchlistId } = req.body;
    try {
      await pool.query('DELETE FROM watchlist WHERE watchlistId = ? AND userId = ?', [watchlistId, userId]);
      res.redirect('/updateProfile');
    } catch (err) {
      console.error('Delete watchlist error:', err);
      const [userRows] = await pool.query(sqlUser, [userId]);
      let userInfo = userRows[0];
      const [watchlistInfo] = await pool.query(sqlWatchlist, [userId]);
      return res.render('updateProfile.ejs', { userInfo, watchlistInfo, error: 'Error deleting watchlist.' });
    }
  } else {
    return res.redirect('/updateProfile');
  }
});

app.get('/deleteProfile', isAuthenticated, async (req, res) => {
  let userId = req.session.userId;
  let sql = `SELECT * FROM Users WHERE userId = ?`;
  const [userRows] = await pool.query(sql, [userId]);
  let userInfo = userRows[0];
  res.render('deleteProfile.ejs', { userInfo });
});

app.post('/deleteProfile', isAuthenticated, async (req, res) => {
  const userId = req.session.userId;

  try {
    await pool.query('DELETE FROM watchlist WHERE userId = ?', [userId]);
    await pool.query('DELETE FROM Users WHERE userId = ?', [userId]);

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
        return res.redirect('/profile');
      }
      res.redirect('/login');
    });
  } catch (err) {
    console.error('Delete profile error:', err);
    res.redirect('/updateProfile');
  }
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

app.post('/watchlist/add', isAuthenticated, async (req, res) => {
  const {
    movie_id,
    title,
    poster_path,
    release_date,
    overview,
    genre
  } = req.body;
  const userId = req.session.userId;

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
      [userId, movie_id, genre, poster_path, release_date, overview]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Add to watchlist error:', err);
    res.status(500).send(`Could not add movie to watchlist: ${err.message}`);
  }
});

app.get('/watchlist', isAuthenticated, async (req, res) => {
  const { status, genre, minRating } = req.query;
  const userId = req.session.userId;

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
  const params = [userId];

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
      [userId]
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

app.post('/watchlist/update', isAuthenticated, async (req, res) => {
  const { id, status, user_rating } = req.body;
  const userId = req.session.userId;

  try {
    const parsedRating =
      user_rating === '' || user_rating == null ? null : Number(user_rating);

    await pool.query(
      `UPDATE watchlist
       SET watchStatus = ?, rating = ?
       WHERE watchlistId = ? AND userId = ?`,
      [status, parsedRating, id, userId]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Watchlist update error:', err);
    res.status(500).send(`Could not update watchlist item: ${err.message}`);
  }
});

app.post('/watchlist/delete', isAuthenticated, async (req, res) => {
  const { id } = req.body;
  const userId = req.session.userId;

  try {
    await pool.query(
      `DELETE FROM watchlist
       WHERE watchlistId = ? AND userId = ?`,
      [id, userId]
    );

    res.redirect('/watchlist');
  } catch (err) {
    console.error('Delete watchlist error:', err);
    res.status(500).send(`Could not remove movie: ${err.message}`);
  }
});

app.get('/movie/:id', async (req, res) => {
  let movieId = req.params.id;

  let details = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.TMDB_API_KEY}`); 
  let credits = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${process.env.TMDB_API_KEY}`);
  //let videos = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/videos?api_key=${process.env.TMDB_API_KEY}`);

  let detailsData = await details.json();
  let creditsData = await credits.json();
  //let videosData = await videos.json();
  let director = creditsData.crew.find(person => person.job === "Director");

  //youtube api
  let query = encodeURIComponent(`${detailsData.title} official trailer`); //builds youtube search phrase
  let ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${query}&key=${process.env.YOUTUBE_API_KEY}`;

  let ytResponse = await fetch(ytUrl);
  let ytData = await ytResponse.json();

  //extracts video ID
  let trailer = ytData.items?.[0]?.id?.videoId || null; //checks items -> first item -> id -> videoId step by step, returns null if nothing is found
  console.log(ytData);
  console.log("Trailer ID:", trailer);

  res.render('movieDetails.ejs', {details: detailsData, cast: creditsData.cast, trailer: trailer, director: director});
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

app.get('/searchBy', async(req, res) => {
    let authorId = req.query.authorId;
    let sql = `SELECT quote, firstName, lastName, authorId
    FROM quotes 
    NATURAL JOIN authors 
    WHERE authorId = ?;`;
    let sqlParams =[ authorId ];
    const [rows] = await pool.query(sql, [authorId]);
    res.render('quotes.ejs', {rows})
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});