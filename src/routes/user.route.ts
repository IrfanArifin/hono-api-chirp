import { Hono } from 'hono'
import {
  getUserProfile,
  updateUserProfile,
  followUser,
  unfollowUser,
  getUserPosts,
  searchUsersByUsername,
} from '../handlers/user.handler'

const userRoute = new Hono()

// User profile endpoints
userRoute.get('/search', searchUsersByUsername) // Pencarian user berdasarkan username
userRoute.get('/:id', getUserProfile) // Mengambil profil user berdasarkan ID sesuai rencana
userRoute.post('/:id/update', updateUserProfile) // Update profil user berdasarkan ID

// Follow relationship endpoints
userRoute.post('/:id/follow', followUser)
userRoute.delete('/:id/unfollow', unfollowUser)

// User posts endpoint
userRoute.get('/:id/posts', getUserPosts)

export default userRoute