import http from './http'

// Admin — Templates
export const getTemplates = () => http.get('/admin/inspection/templates')
export const createTemplate = (data) => http.post('/admin/inspection/templates', data)
export const getTemplate = (id) => http.get(`/admin/inspection/templates/${id}`)
export const updateTemplate = (id, data) => http.patch(`/admin/inspection/templates/${id}`, data)
export const deleteTemplate = (id) => http.delete(`/admin/inspection/templates/${id}`)

// Admin — Check Items
export const addCheckItem = (templateId, data) => http.post(`/admin/inspection/templates/${templateId}/items`, data)
export const updateCheckItem = (id, data) => http.patch(`/admin/inspection/items/${id}`, data)
export const deleteCheckItem = (id) => http.delete(`/admin/inspection/items/${id}`)

// Admin — Inspections
export const getInspections = (params) => http.get('/admin/inspection/list', { params })
export const getInspection = (id) => http.get(`/admin/inspection/${id}`)

// Admin — Issues
export const getIssues = (params) => http.get('/admin/inspection/issues', { params })
export const createIssue = (data) => http.post('/admin/inspection/issues', data)
export const updateIssue = (id, data) => http.patch(`/admin/inspection/issues/${id}`, data)

// Store — Templates
export const getStoreTemplates = () => http.get('/store/inspection/templates')
export const getStoreTemplate = (id) => http.get(`/store/inspection/templates/${id}`)

// Store — Inspections
export const startInspection = (data) => http.post('/store/inspection/start', data)
export const submitInspection = (id, data) => http.post(`/store/inspection/${id}/submit`, data)
export const getStoreHistory = (params) => http.get('/store/inspection/history', { params })

// Auth
export const login = (data) => http.post('/auth/login', data)
