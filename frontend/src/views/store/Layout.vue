<template>
  <div class="store-layout">
    <router-view />
    <van-tabbar v-model="active" route>
      <van-tabbar-item icon="todo-list-o" to="/store/inspect">巡检</van-tabbar-item>
      <van-tabbar-item icon="edit" to="/store/self-check">自检</van-tabbar-item>
      <van-tabbar-item icon="clock-o" to="/store/history">历史</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup>
import { ref } from 'vue'
const active = ref(0)
</script>

<style scoped>
.store-layout { padding-bottom: 60px; }
</style>
