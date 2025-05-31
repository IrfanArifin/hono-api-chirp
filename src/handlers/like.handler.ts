import { Context } from 'hono';
import { verify, JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken'; 
import { query } from '../lib/db'; 


const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET is not defined in environment variables.");
}

/**
 * Fungsi helper untuk mendapatkan userId dari token JWT di header Authorization.
 * @param c Konteks Hono
 * @returns userId jika token valid, selain itu null.
 */
function getUserIdFromToken(c: Context): number | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // console.warn('Authorization header missing or not Bearer'); // Aktifkan untuk debug jika perlu
    return null;
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    // console.warn('Token not found after Bearer'); // Aktifkan untuk debug jika perlu
    return null;
  }

  try {
    const payload = verify(token, JWT_SECRET!) as { id: number; };
    if (typeof payload.id !== 'number') {
        console.warn('Invalid payload structure: id is not a number or missing.');
        return null;
    }
    return payload.id;
  } catch (error) {
    if (error instanceof JsonWebTokenError || error instanceof TokenExpiredError) {
      // console.warn(`Token verification failed: ${error.message}`); // Aktifkan untuk debug jika perlu
    } else {
      console.error('Unexpected error during token verification:', error);
    }
    return null;
  }
}

export const likePost = async (c: Context) => {
  const userId = getUserIdFromToken(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized. Invalid or missing token.' }, 401);
  }

  const postIdString = c.req.param('id');
  const postId = Number(postIdString);
  if (isNaN(postId) || postId <= 0) { 
    return c.json({ error: 'Invalid post ID. Must be a positive number.' }, 400);
  }

  try {
    // 1. Cek apakah postingan ada
    const postExists = await query(
      'SELECT id FROM post WHERE id = $1',
      [postId]
    );
    if (postExists.length === 0) {
      return c.json({ error: 'Post not found.' }, 404);
    }

    // 2. Cek apakah like sudah ada
    const existingLike = await query(
      'SELECT "id" FROM likes WHERE "userId" = $1 AND "postId" = $2',
      [userId, postId]
    );

    if (existingLike.length > 0) {
      return c.json({ liked: true, message: 'Post was already liked.' }, 200); 
    }

    // 3. Tambahkan like
    await query(
      'INSERT INTO likes ("userId", "postId") VALUES ($1, $2) ON CONFLICT ON CONSTRAINT unique_like DO NOTHING',
      [userId, postId]
    );

    return c.json({ liked: true, message: 'Post liked successfully.' }, 201); 
  } catch (dbError: any) {
    console.error(`Database error in likePost (userId: ${userId}, postId: ${postId}):`, dbError.message, dbError.stack);
    return c.json({ error: 'Failed to process like request due to a server error.' }, 500);
  }
};

/**
 * Handler untuk batal menyukai (unlike) sebuah post.
 * Memastikan operasi bersifat idempoten.
 */
export const unlikePost = async (c: Context) => {
  const userId = getUserIdFromToken(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized. Invalid or missing token.' }, 401);
  }

  const postIdString = c.req.param('id');
  const postId = Number(postIdString);
  if (isNaN(postId) || postId <= 0) { 
    return c.json({ error: 'Invalid post ID. Must be a positive number.' }, 400);
  }

  try {
    // 1. Cek apakah postingan ada
    const postExists = await query(
      'SELECT id FROM post WHERE id = $1',
      [postId]
    );
    if (postExists.length === 0) {
      return c.json({ error: 'Post not found.' }, 404);
    }

    // 2. Cek apakah pengguna sudah menyukai postingan
    const existingLike = await query(
      'SELECT "id" FROM likes WHERE "userId" = $1 AND "postId" = $2',
      [userId, postId]
    );

    if (existingLike.length === 0) {
      return c.json({ liked: false, message: 'You have not liked this post.' }, 200);
    }

    // 3. Hapus like
    const deleteResult = await query(
      'DELETE FROM likes WHERE "userId" = $1 AND "postId" = $2 RETURNING "id"',
      [userId, postId]
    );

    if (deleteResult.length === 0) {
      return c.json({ liked: false, message: 'Failed to unlike post.' }, 500);
    }

    return c.json({ liked: false, message: 'Post unliked successfully.' }, 200);
  } catch (dbError: any) {
    console.error(`Database error in unlikePost (userId: ${userId}, postId: ${postId}):`, dbError.message, dbError.stack);
    return c.json({ error: 'Failed to process unlike request due to a server error.' }, 500);
  }
};
