import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/login', component: () => import('../views/Login.vue') },
  {
    path: '/admin',
    component: () => import('../views/admin/Layout.vue'),
    children: [
      { path: '', redirect: '/admin/templates' },
      { path: 'templates', component: () => import('../views/admin/Templates.vue') },
      { path: 'templates/:id', component: () => import('../views/admin/TemplateDetail.vue') },
      { path: 'inspections', component: () => import('../views/admin/Inspections.vue') },
      { path: 'issues', component: () => import('../views/admin/Issues.vue') },
    ]
  },
  {
    path: '/store',
    component: () => import('../views/store/Layout.vue'),
    children: [
      { path: '', redirect: '/store/inspect' },
      { path: 'inspect', component: () => import('../views/store/Inspect.vue') },
      { path: 'inspect/:id', component: () => import('../views/store/InspectForm.vue') },
      { path: 'history', component: () => import('../views/store/History.vue') },
    ]
  },
  { path: '/', redirect: '/login' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  if (to.path !== '/login' && !localStorage.getItem('token')) {
    return '/login'
  }
})

export default router
