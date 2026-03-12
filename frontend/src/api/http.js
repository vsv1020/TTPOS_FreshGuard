import axios from 'axios'
import { showToast } from 'vant'

const http = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

http.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.error || err.message || 'Network Error'
    showToast({ message: msg, position: 'top' })
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.hash = '#/login'
    }
    return Promise.reject(err)
  }
)

export default http
