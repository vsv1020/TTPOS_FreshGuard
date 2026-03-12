<template>
  <div class="admin-layout">
    <router-view />
    <van-tabbar v-model="active" route>
      <van-tabbar-item icon="orders-o" to="/admin/templates">Templates</van-tabbar-item>
      <van-tabbar-item icon="todo-list-o" to="/admin/inspections">Inspections</van-tabbar-item>
      <van-tabbar-item icon="warning-o" to="/admin/issues" :badge="issueCount || ''">Issues</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getIssues } from '../../api/inspection'

const active = ref(0)
const issueCount = ref(0)

onMounted(async () => {
  try {
    const res = await getIssues({ status: 'open' })
    issueCount.value = res.issues?.length || 0
  } catch {}
})
</script>

<style scoped>
.admin-layout { padding-bottom: 60px; }
</style>
