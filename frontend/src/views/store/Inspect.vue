<template>
  <van-nav-bar title="Start Inspection" />
  <van-pull-refresh v-model="refreshing" @refresh="load">
    <van-empty v-if="!loading && templates.length === 0" description="No templates available" />
    <van-cell-group inset v-for="t in templates" :key="t.id" style="margin-top: 12px">
      <van-cell :title="t.name" :label="t.description || 'No description'" is-link :to="`/store/inspect/${t.id}`" />
    </van-cell-group>
  </van-pull-refresh>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getStoreTemplates } from '../../api/inspection'

const templates = ref([])
const loading = ref(true)
const refreshing = ref(false)

async function load() {
  try {
    const res = await getStoreTemplates()
    templates.value = res.templates || res || []
  } catch {} finally { loading.value = false; refreshing.value = false }
}

onMounted(load)
</script>
