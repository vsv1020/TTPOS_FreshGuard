<template>
  <van-nav-bar :title="template?.name || 'Template'" left-arrow @click-left="$router.back()" />
  
  <van-loading v-if="loading" style="text-align: center; padding: 40px" />

  <template v-else-if="template">
    <van-cell-group inset style="margin-top: 12px">
      <van-cell title="Name" :value="template.name" />
      <van-cell title="Description" :value="template.description || '-'" />
      <van-cell title="Status">
        <template #value>
          <van-tag :type="template.is_active ? 'success' : 'default'">{{ template.is_active ? 'Active' : 'Inactive' }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>

    <div style="padding: 12px 16px; font-weight: bold; font-size: 16px">
      Check Items ({{ items.length }})
      <van-button size="small" type="primary" plain style="float: right" @click="showAddItem = true">+ Add</van-button>
    </div>

    <van-empty v-if="items.length === 0" description="No check items" image="search" />

    <van-cell-group inset v-for="(item, idx) in items" :key="item.id" style="margin-top: 8px">
      <van-swipe-cell>
        <van-cell :title="`${idx + 1}. ${item.name}`" :label="item.description || ''">
          <template #right-icon>
            <van-tag type="primary" plain>{{ item.category || 'General' }}</van-tag>
            <span style="margin-left: 8px; color: #999">×{{ item.max_score }}</span>
          </template>
        </van-cell>
        <template #right>
          <van-button square type="danger" text="Delete" @click="onDeleteItem(item.id)" />
        </template>
      </van-swipe-cell>
    </van-cell-group>
  </template>

  <van-popup v-model:show="showAddItem" position="bottom" round style="padding: 20px">
    <h3 style="margin: 0 0 16px">Add Check Item</h3>
    <van-form @submit="onAddItem">
      <van-field v-model="newItem.name" label="Name" placeholder="Check item name" :rules="[{ required: true }]" />
      <van-field v-model="newItem.description" label="Description" placeholder="Optional" />
      <van-field v-model="newItem.category" label="Category" placeholder="e.g. Hygiene, Safety" />
      <van-field v-model.number="newItem.max_score" label="Max Score" type="digit" placeholder="10" />
      <van-button round block type="primary" native-type="submit" :loading="adding" style="margin-top: 16px">Add</van-button>
    </van-form>
  </van-popup>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { getTemplate, addCheckItem, deleteCheckItem } from '../../api/inspection'

const route = useRoute()
const template = ref(null)
const items = ref([])
const loading = ref(true)
const showAddItem = ref(false)
const adding = ref(false)
const newItem = ref({ name: '', description: '', category: '', max_score: 10 })

async function loadTemplate() {
  try {
    const res = await getTemplate(route.params.id)
    template.value = res.template || res
    items.value = res.items || []
  } catch {} finally { loading.value = false }
}

async function onAddItem() {
  adding.value = true
  try {
    await addCheckItem(route.params.id, { ...newItem.value, sort_order: items.value.length })
    showToast({ message: 'Added', type: 'success' })
    showAddItem.value = false
    newItem.value = { name: '', description: '', category: '', max_score: 10 }
    await loadTemplate()
  } catch {} finally { adding.value = false }
}

async function onDeleteItem(id) {
  try {
    await showConfirmDialog({ title: 'Delete', message: 'Delete this check item?' })
    await deleteCheckItem(id)
    showToast({ message: 'Deleted', type: 'success' })
    await loadTemplate()
  } catch {}
}

onMounted(loadTemplate)
</script>
