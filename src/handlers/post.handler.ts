import { Context } from 'hono';
import { verify, JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken'; 
import { query } from '../lib/db'; 


const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET is not defined in environment variables.");
}

/**
 * Fungsi helper untuk mendapatkan userId dari token JWT di header Authorization.
 */
function getUserIdFromToken(c: Context): number | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return null;
  }

  try {
    const payload = verify(token, JWT_SECRET!) as { id: number; [key: string]: any };
    if (typeof payload.id !== 'number') {
        console.warn('Invalid payload structure: id is not a number or missing.');
        return null;
    }
    return payload.id;
  } catch (error) {
    if (error instanceof JsonWebTokenError || error instanceof TokenExpiredError) {
      return null;
    } else {
      console.error('Unexpected error during token verification:', error);
    }
    return null;
  }
}

/**
 * Handler untuk mendapatkan semua post.
 */
export const getAllPosts = async (c: Context) => {
  const userId = getUserIdFromToken(c);

  // Validasi: Pastikan pengguna sudah login
  if (!userId) {
    return c.json({ error: 'Unauthorized: You must be logged in to view your posts.' }, 401);
  }

  try {
    console.log('Mengambil postingan dengan userId:', userId);
    const posts = await query(`
      SELECT 
          p.id,
          p.content,
          p.image,
          p."createdAt", 
          p."updatedAt",
          p."authorId", 
          u.username AS author_username,
          u.image AS author_image,
          (SELECT COUNT(*) FROM likes l_count WHERE l_count."postId" = p.id) AS like_count,
          (SELECT COUNT(*) FROM reply r_count WHERE r_count."postId" = p.id) AS reply_count,
          CASE
              WHEN $1::INTEGER IS NOT NULL THEN EXISTS (
                  SELECT 1 
                  FROM likes l_liked
                  WHERE l_liked."postId" = p.id AND l_liked."userId" = $1::INTEGER
              )
              ELSE FALSE
          END AS liked_by_me
      FROM post p
      JOIN users u ON p."authorId" = u.id
      WHERE p."authorId" = $1::INTEGER
      ORDER BY p."createdAt" DESC
    `, [userId]);

    console.log('Hasil query:', posts);
    return c.json(posts);
  } catch (dbError: any) {
    console.error('Error database di getAllPosts:', {
      message: dbError.message,
      stack: dbError.stack,
      query: 'SELECT ...',
      params: [userId],
    });
    return c.json({ error: 'Gagal mengambil postingan karena error server.' }, 500);
  }
};

/**
 * Handler untuk mendapatkan post berdasarkan ID.
 */
export const getPostById = async (c: Context) => {
  const userId = getUserIdFromToken(c); // Ambil userId dari token (bisa null)
  const postId = parseInt(c.req.param('id')); // Ambil ID dari parameter URL

  if (isNaN(postId)) {
    return c.json({ error: 'Invalid post ID' }, 400);
  }

  try {
    console.log('Mengambil postingan dengan postId:', postId, 'userId:', userId);
    const post = await query(`
      SELECT 
          p.id,
          p.content,
          p.image,
          p."createdAt", 
          p."updatedAt",
          p."authorId", 
          u.username AS author_username,
          u.image AS author_image,
          (SELECT COUNT(*) FROM likes l_count WHERE l_count."postId" = p.id) AS like_count,
          (SELECT COUNT(*) FROM reply r_count WHERE r_count."postId" = p.id) AS reply_count,
          CASE
              WHEN $1::INTEGER IS NOT NULL THEN EXISTS (
                  SELECT 1 
                  FROM likes l_liked
                  WHERE l_liked."postId" = p.id AND l_liked."userId" = $1::INTEGER
              )
              ELSE FALSE
          END AS liked_by_me
      FROM post p
      JOIN users u ON p."authorId" = u.id
      WHERE p.id = $2::INTEGER
      LIMIT 1
    `, [userId || null, postId]);

    if (post.length === 0) {
      return c.json({ error: 'Post not found' }, 404);
    }

    console.log('Hasil query:', post);
    return c.json(post[0]); // Kembalikan hanya satu postingan
  } catch (dbError: any) {
    console.error('Error database di getPostById:', {
      message: dbError.message,
      stack: dbError.stack,
      query: 'SELECT ...', // Ganti dengan query di atas
      params: [userId || null, postId],
    });
    return c.json({ error: 'Failed to retrieve post due to a server error.' }, 500);
  }
};

/**
 * Handler untuk membuat post baru.
 */
export const createPost = async (c: Context) => {
  const userId = getUserIdFromToken(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized. User must be logged in to create a post.' }, 401);
  }

  try {
    const { content, image } = await c.req.json();

    if (!content || typeof content !== 'string' || content.trim() === '') {
      return c.json({ error: 'Content is required and cannot be empty.' }, 400);
    }
    if (image && typeof image !== 'string') { 
        return c.json({ error: 'Image must be a valid URL string if provided.' }, 400);
    }

    const result = await query(
      'INSERT INTO post (content, image, "authorId") VALUES ($1, $2, $3) RETURNING *',
      [content.trim(), image || null, userId]
    );

    if (result.length === 0) {
        return c.json({ error: 'Failed to create post after insertion.' }, 500);
    }
    
    return c.json(result[0], 201);

  } catch (parseError: any) {
    if (parseError instanceof SyntaxError) { 
        return c.json({ error: 'Invalid JSON format in request body.' }, 400);
    }
    console.error('Error in createPost:', parseError.message, parseError.stack);
    return c.json({ error: 'Failed to create post due to a server error.' }, 500);
  }
};

/**
 * Handler untuk menghapus post.
 */
export const deletePost = async (c: Context) => {
  const userId = getUserIdFromToken(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized. User must be logged in.' }, 401);
  }

  const postIdString = c.req.param('id');
  const postId = Number(postIdString);

  if (isNaN(postId) || postId <= 0) {
    return c.json({ error: 'Invalid post ID. Must be a positive number.' }, 400);
  }

  try {
    const postCheckResult = await query(
      'SELECT "authorId" FROM post WHERE id = $1',
      [postId]
    );

    if (postCheckResult.length === 0) {
      return c.json({ error: 'Post not found.' }, 404);
    }

    if (postCheckResult[0].authorId !== userId) { 
      return c.json({ error: 'Forbidden. You are not authorized to delete this post.' }, 403);
    }

    await query(
      'DELETE FROM post WHERE id = $1',
      [postId]
    );

    return c.json({ message: 'Post deleted successfully.' }); 
  } catch (dbError: any) {
    console.error(`Database error in deletePost (postId: ${postId}):`, dbError.message, dbError.stack);
    return c.json({ error: 'Failed to delete post due to a server error.' }, 500);
  }
};