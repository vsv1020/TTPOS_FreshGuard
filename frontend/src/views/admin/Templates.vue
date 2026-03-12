<template>
  <van-nav-bar title="Inspection Templates" />
  <van-pull-refresh v-model="refreshing" @refresh="loadTemplates">
    <van-empty v-if="!loading && templates.length === 0" description="No templates yet" />
    <van-cell-group inset v-for="t in templates" :key="t.id" style="margin-top: 12px">
      <van-cell :title="t.name" :label="t.description || 'No description'" is-link :to="`/admin/templates/${t.id}`">
        <template #right-icon>
          <van-tag :type="t.is_active ? 'success' : 'default'">{{ t.is_active ? 'Active' : 'Inactive' }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>
  </van-pull-refresh>

  <van-floating-bubble icon="plus" @click="showCreate = true" />

  <van-popup v-model:show="showCreate" position="bottom" round style="padding: 20px">
    <h3 style="margin: 0 0 16px">New Template</h3>
    <van-form @submit="onCreate">
      <van-field v-model="newTemplate.name" label="Name" placeholder="Template name" :rules="[{ required: true }]" />
      <van-field v-model="newTemplate.description" label="Description" placeholder="Optional" type="textarea" rows="2" />
      <van-button round block type="primary" native-type="submit" :loading="creating" style="margin-top: 16px">Create</van-button>
    </van-form>
  </van-popup>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showToast } from 'vant'
import { getTemplates, createTemplate } from '../../api/inspection'

const templates = ref([])
const loading = ref(true)
const refreshing = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const newTemplate = ref({ name: '', description: '' })

async function loadTemplates() {
  try {
    const res = await getTemplates()
    templates.value = res.templates || res || []
  } catch {} finally {
    loading.value = false
    refreshing.value = false
  }
}

async function onCreate() {
  creating.value = true
  try {
    await createTemplate(newTemplate.value)
    showToast({ message: 'Created', type: 'success' })
    showCreate.value = false
    newTemplate.value = { name: '', description: '' }
    await loadTemplates()
  } catch {} finally {
    creating.value = false
  }
}

onMounted(loadTemplates)
</script>
