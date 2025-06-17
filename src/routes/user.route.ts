import { Hono } from 'hono'
import {
  getAllUsers,
  getUserProfile,
  updateUserProfile,
  toggleFollow,
  getUserPosts,
  searchUsersByUsername,
} from '../handlers/user.handler'

const userRoute = new Hono()

// User profile endpoints
userRoute.get('', getAllUsers) // Mengambil semua user
userRoute.get('/search', searchUsersByUsername) // Pencarian user berdasarkan username
userRoute.get('/:id', getUserProfile) // Mengambil profil user berdasarkan ID sesuai rencana
userRoute.patch('/:id/update', updateUserProfile) // Update profil user berdasarkan ID

// Follow relationship endpoints
userRoute.post('/:id/toggle-follow', toggleFollow)


// User posts endpoint
userRoute.get('/:id/posts', getUserPosts)

export default userRoute