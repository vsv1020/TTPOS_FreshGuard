<template>
  <van-nav-bar title="Inspection History" />
  <van-pull-refresh v-model="refreshing" @refresh="load">
    <van-empty v-if="!loading && list.length === 0" description="No inspections yet" />
    <van-cell-group inset v-for="ins in list" :key="ins.id" style="margin-top: 12px">
      <van-cell :title="ins.template_name || `Inspection #${ins.id}`" :label="ins.created_at?.slice(0, 16)">
        <template #right-icon>
          <van-tag :type="ins.status === 'completed' ? 'success' : 'warning'">{{ ins.status }}</van-tag>
          <span v-if="ins.total_score != null" style="margin-left: 8px; font-weight: bold">{{ ins.total_score }}pts</span>
        </template>
      </van-cell>
    </van-cell-group>
  </van-pull-refresh>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getStoreHistory } from '../../api/inspection'

const list = ref([])
const loading = ref(true)
const refreshing = ref(false)

async function load() {
  try {
    const res = await getStoreHistory()
    list.value = res.inspections || res || []
  } catch {} finally { loading.value = false; refreshing.value = false }
}

onMounted(load)
</script>
