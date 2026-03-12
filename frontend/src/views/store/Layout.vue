<template>
  <div class="store-layout">
    <router-view />
    <van-tabbar v-model="active" route>
      <van-tabbar-item icon="todo-list-o" to="/store/inspect">Inspect</van-tabbar-item>
      <van-tabbar-item icon="clock-o" to="/store/history">History</van-tabbar-item>
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
