<template>
  <div class="login-page">
    <div class="login-header">
      <h1>🛡️ FreshGuard</h1>
      <p>Food Safety Inspection System</p>
    </div>
    <van-form @submit="onLogin" class="login-form">
      <van-cell-group inset>
        <van-field v-model="form.email" label="Email" placeholder="admin@example.com" :rules="[{ required: true }]" />
        <van-field v-model="form.password" type="password" label="Password" placeholder="Password" :rules="[{ required: true }]" />
      </van-cell-group>
      <div class="login-actions">
        <van-button round block type="primary" native-type="submit" :loading="loading">Login</van-button>
      </div>
      <van-tabs v-model:active="roleTab" class="role-tabs">
        <van-tab title="Admin" />
        <van-tab title="Store" />
      </van-tabs>
    </van-form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { login } from '../api/inspection'

const router = useRouter()
const form = ref({ email: '', password: '' })
const loading = ref(false)
const roleTab = ref(0)

async function onLogin() {
  loading.value = true
  try {
    const res = await login(form.value)
    localStorage.setItem('token', res.token)
    localStorage.setItem('role', res.user?.role || (roleTab.value === 0 ? 'admin' : 'store'))
    showToast({ message: 'Login success', position: 'top', type: 'success' })
    router.push(roleTab.value === 0 ? '/admin' : '/store')
  } catch (e) {
    // handled by interceptor
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
.login-header { text-align: center; margin-bottom: 30px; }
.login-header h1 { font-size: 28px; margin: 0; }
.login-header p { color: #999; margin-top: 8px; }
.login-form { width: 100%; max-width: 400px; }
.login-actions { padding: 16px; }
.role-tabs { margin-top: 16px; }
</style>
