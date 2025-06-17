import { Context } from 'hono';
import { z } from 'zod';
import { jwtVerify } from 'jose'; 
import { query } from '../lib/db'; 


const JWT_SECRET_KEY = process.env.JWT_SECRET;
if (!JWT_SECRET_KEY) {
    console.error("FATAL ERROR: JWT_SECRET tidak didefinisikan di environment variables.");
}
const secret = new TextEncoder().encode(JWT_SECRET_KEY);

// Skema validasi untuk path parameter ID
const idParamSchema = z.object({
    id: z.coerce.number().int().positive({ message: "User ID harus berupa angka positif." })
});

// Skema validasi untuk update profil
const updateUserProfileSchema = z.object({
    bio: z.string().max(500, "Bio tidak boleh melebihi 500 karakter.").optional().nullable(),
    image: z.string().url("Gambar harus berupa URL yang valid.").optional().nullable(),
});


// --- Fungsi Helper Tunggal untuk Otentikasi ---

/**  * Mengambil userId dari header Authorization.
 * Fungsi helper untuk mengambil userId dari token di header Authorization.
 * Ini adalah satu-satunya fungsi yang kita butuhkan untuk otentikasi.
 */
const getUserIdFromAuthHeader = async (c: Context): Promise<number | null> => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    
    const token = authHeader.substring(7);
    if (!token) return null;

    try {
        const { payload } = await jwtVerify(token, secret);
        return typeof payload.id === 'number' ? payload.id : null;
    } catch (e) {
        // Token tidak valid (kadaluwarsa, format salah, dll.)
        return null;
    }
};
/**
 * Handler untuk mengambil daftar semua pengguna (dengan paginasi).
 * Menyertakan status 'isFollowing' untuk setiap user.
 */
export const getAllUsers = async (c: Context) => {
    const loggedInUserId = await getUserIdFromAuthHeader(c);
    if (!loggedInUserId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const page = parseInt(c.req.query('page') || '1', 10);
    const offset = (page - 1) * limit;

    try {
        const users = await query(`
            SELECT 
                u.id, 
                u.username, 
                u."fullName", 
                u.image,
                EXISTS (
                    SELECT 1 FROM follow 
                    WHERE "followerId" = $1 AND "followingId" = u.id
                ) AS "isFollowing"
            FROM users u
            WHERE u.id != $1
            ORDER BY u."createdAt" DESC
            LIMIT $2 OFFSET $3
        `, [loggedInUserId, limit, offset]);

        return c.json(users);
    } catch (dbError: any) {
        console.error('Error di getAllUsers:', dbError);
        return c.json({ error: 'Gagal mengambil daftar pengguna.' }, 500);
    }
};

/**
 * Handler untuk mendapatkan profil pengguna, lengkap dengan status follow.
 */
export const getUserProfile = async (c: Context) => {
    const loggedInUserId = await getUserIdFromAuthHeader(c);

    const result = idParamSchema.safeParse({ id: c.req.param('id') });
    if (!result.success) {
        return c.json({ error: result.error.format() }, 400);
    }
    const requestedUserId = result.data.id;

    try {
        const userResult = await query('SELECT id, username, "fullName", bio, image FROM users WHERE id = $1', [requestedUserId]);
        if (userResult.length === 0) {
            return c.json({ error: 'Pengguna tidak ditemukan.' }, 404);
        }
        
        const [followerCountResult, followingCountResult] = await Promise.all([
            query('SELECT COUNT(*) FROM follow WHERE "followingId" = $1', [requestedUserId]),
            query('SELECT COUNT(*) FROM follow WHERE "followerId" = $1', [requestedUserId])
        ]);

        let isFollowing = false;
        if (loggedInUserId && loggedInUserId !== requestedUserId) {
            const isFollowingResult = await query('SELECT 1 FROM follow WHERE "followerId" = $1 AND "followingId" = $2', [loggedInUserId, requestedUserId]);
            isFollowing = isFollowingResult.length > 0;
        }

        return c.json({
            user: userResult[0],
            followerCount: parseInt(followerCountResult[0].count, 10),
            followingCount: parseInt(followingCountResult[0].count, 10),
            isFollowing,
        });
    } catch (dbError: any) {
        console.error(`Error di getUserProfile (id: ${requestedUserId}):`, dbError);
        return c.json({ error: 'Gagal mengambil profil pengguna.' }, 500);
    }
};

/**
 * Handler untuk follow/unfollow (toggle) yang AMAN.
 * Ini adalah handler yang Anda butuhkan untuk fitur follow/unfollow.
 */
export const toggleFollow = async (c: Context) => {
    const authenticatedUserId = await getUserIdFromAuthHeader(c);

    if (!authenticatedUserId) {
        return c.json({ error: 'Unauthorized: Token tidak valid atau tidak ada.' }, 401);
    }
    
    const body = await c.req.json();
    const followerId = body.followerId as number; 

    const result = idParamSchema.safeParse({ id: c.req.param('id') });
    if (!result.success) {
        return c.json({ error: result.error.format() }, 400);
    }
    const followingId = result.data.id;

    // Keamanan Kunci: Pastikan pengguna yang login hanya bisa beraksi untuk dirinya sendiri.
    if (authenticatedUserId !== followerId) {
        return c.json({ error: 'Forbidden: Anda tidak dapat melakukan aksi untuk pengguna lain.' }, 403);
    }
    if (followerId === followingId) {
        return c.json({ error: 'Anda tidak bisa mengikuti diri sendiri.' }, 400);
    }

    try {
        const isCurrentlyFollowing = (await query(
            `SELECT 1 FROM follow WHERE "followerId" = $1 AND "followingId" = $2`,
            [followerId, followingId]
        )).length > 0;

        if (isCurrentlyFollowing) {
            await query('DELETE FROM follow WHERE "followerId" = $1 AND "followingId" = $2', [followerId, followingId]);
        } else {
            const userExists = await query('SELECT 1 FROM users WHERE id = $1', [followingId]);
            if (userExists.length === 0) {
                return c.json({ error: 'Pengguna yang akan diikuti tidak ditemukan.' }, 404);
            }
            await query('INSERT INTO follow ("followerId", "followingId") VALUES ($1, $2)', [followerId, followingId]);
        }

        const newCountResult = await query('SELECT COUNT(*) FROM follow WHERE "followingId" = $1', [followingId]);
        
        return c.json({
            message: isCurrentlyFollowing ? 'Berhasil berhenti mengikuti.' : 'Berhasil mengikuti.',
            isFollowing: !isCurrentlyFollowing,
            newFollowerCount: parseInt(newCountResult[0].count, 10),
        }, 200);
    } catch (dbError: any) {
        console.error('Error database di toggleFollow:', dbError);
        return c.json({ error: 'Terjadi kesalahan pada server.' }, 500);
    }
};

/**
 * Handler untuk mendapatkan semua post dari seorang pengguna.
 */
export const getUserPosts = async (c: Context) => {
    const result = idParamSchema.safeParse({ id: c.req.param('id') });
    if (!result.success) {
        return c.json({ error: result.error.format() }, 400);
    }
    const authorIdForPosts = result.data.id;
    const loggedInUserId = await getUserIdFromAuthHeader(c);

    try {
        const posts = await query(`
            SELECT 
                p.id, p.content, p.image, p."createdAt", u.username AS author_username,
                (SELECT COUNT(*) FROM likes WHERE "postId" = p.id) AS like_count,
                (SELECT COUNT(*) FROM reply WHERE "postId" = p.id) AS reply_count,
                CASE
                    WHEN $2::INTEGER IS NOT NULL THEN EXISTS (
                        SELECT 1 FROM likes WHERE "postId" = p.id AND "userId" = $2::INTEGER
                    )
                    ELSE FALSE
                END AS liked_by_me
            FROM post p
            JOIN users u ON p."authorId" = u.id
            WHERE p."authorId" = $1
            ORDER BY p."createdAt" DESC
        `, [authorIdForPosts, loggedInUserId]);

        return c.json(posts);
    } catch (dbError: any) {
        console.error(`Error di getUserPosts (id: ${authorIdForPosts}):`, dbError);
        return c.json({ error: 'Gagal mengambil postingan pengguna.' }, 500);
    }
};


/**
 * Handler untuk mencari user berdasarkan username
 */
export const searchUsersByUsername = async (c: Context) => {
    let username = c.req.query('username');
    console.log('Username awal dari query param:', JSON.stringify(username));

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return c.json({ error: 'Query parameter "username" is required and cannot be empty.' }, 400);
    }

    username = username.trim();
    console.log('Username setelah trim:', JSON.stringify(username));

    try {
        // Cari user berdasarkan username, ambil 1 user teratas yang matching
        const userResult = await query(
            `SELECT id, username, "fullName", email, bio, image, "createdAt", "updatedAt"
             FROM users
             WHERE LOWER(username) LIKE LOWER($1)
             ORDER BY "createdAt" DESC
             LIMIT 1`,
            [`%${username}%`]
        );

        if (userResult.length === 0) {
            return c.json({ error: 'User not found.' }, 404);
        }
        const user = userResult[0];

        // Ambil userId dari token (bisa null jika tidak login)
        const loggedInUserId = await getUserIdFromAuthHeader(c);

        // Hitung followerCount
        const followerCountResult = await query(
            'SELECT COUNT(*) AS count FROM follow WHERE "followingId" = $1',
            [user.id]
        );
        const followerCount = Number(followerCountResult[0]?.count || 0);

        // Hitung followingCount
        const followingCountResult = await query(
            'SELECT COUNT(*) AS count FROM follow WHERE "followerId" = $1',
            [user.id]
        );
        const followingCount = Number(followingCountResult[0]?.count || 0);

        // Cek apakah user login mengikuti user yang dicari
        let isFollowing = false;
        if (loggedInUserId && loggedInUserId !== user.id) {
            const isFollowingResult = await query(
                'SELECT 1 FROM follow WHERE "followerId" = $1 AND "followingId" = $2',
                [loggedInUserId, user.id]
            );
            isFollowing = isFollowingResult.length > 0;
        }

        // Kembalikan response yang sama seperti getUserProfile
        return c.json({
            user,
            followerCount,
            followingCount,
            isFollowing: loggedInUserId ? isFollowing : false,
        });

    } catch (error: any) {
        console.error(`Database error in searchUserCompleteProfileByUsername (username: ${username}):`, error.message, error.stack);
        return c.json({ error: 'Failed to search user due to a server error.' }, 500);
    }
};

/**
 * Handler untuk memperbarui profil pengguna yang sedang login.
 */
export const updateUserProfile = async (c: Context) => {
    const userId = getUserIdFromAuthHeader(c);
    if (!userId) {
        return c.json({ error: 'Unauthorized. User must be logged in.' }, 401);
    }

    try {
        const body = await c.req.json();
        const validationResult = updateUserProfileSchema.safeParse(body);

        if (!validationResult.success) {
            return c.json({ error: validationResult.error.format() }, 400);
        }
        const { bio, image } = validationResult.data;

        if (bio === undefined && image === undefined) {
             const currentUser = await query('SELECT * FROM users WHERE id = $1', [userId]); 
             if (currentUser.length > 0) return c.json(currentUser[0]);
             return c.json({message: "No data provided for update"}, 400);
        }

        const updateUserResult = await query(
            'UPDATE users SET bio = COALESCE($1, bio), image = COALESCE($2, image), "updatedAt" = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, username, email, bio, image, "createdAt", "updatedAt"',
            [bio, image, userId]
        );

        if (updateUserResult.length === 0) {
            return c.json({ error: 'User not found or update failed.' }, 404);
        }

        return c.json(updateUserResult[0]);

    } catch (error: any) {
        if (error instanceof SyntaxError && 'body' in error) {
            return c.json({ error: 'Invalid JSON format in request body.' }, 400);
        }
        console.error(`Error in updateUserProfile (userId: ${userId}):`, error.message, error.stack);
        return c.json({ error: 'Failed to update profile due to a server error.' }, 500);
    }
};
