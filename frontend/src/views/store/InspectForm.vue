<template>
  <van-nav-bar :title="template?.name || 'Inspection'" left-arrow @click-left="$router.back()" />
  
  <van-loading v-if="loading" style="text-align: center; padding: 40px" />

  <template v-else-if="template && inspectionId">
    <van-steps :active="currentStep" style="padding: 16px 0">
      <van-step v-for="(item, idx) in items" :key="item.id">{{ idx + 1 }}</van-step>
    </van-steps>

    <van-cell-group inset style="margin-top: 12px" v-if="currentItem">
      <van-cell :title="currentItem.name" :label="currentItem.description || ''" />
      <van-cell title="Category" :value="currentItem.category || 'General'" />
      <van-cell :title="`Score (max ${currentItem.max_score})`">
        <template #value>
          <van-stepper v-model="scores[currentItem.id]" :min="0" :max="currentItem.max_score" theme="round" />
        </template>
      </van-cell>
      <van-field v-model="notes[currentItem.id]" label="Note" placeholder="Optional note" type="textarea" rows="2" />
    </van-cell-group>

    <div style="padding: 16px; display: flex; gap: 12px">
      <van-button v-if="currentStep > 0" plain round @click="currentStep--" style="flex: 1">Previous</van-button>
      <van-button v-if="currentStep < items.length - 1" type="primary" round @click="currentStep++" style="flex: 1">Next</van-button>
      <van-button v-if="currentStep === items.length - 1" type="success" round @click="onSubmit" :loading="submitting" style="flex: 1">Submit</van-button>
    </div>

    <van-cell-group inset style="margin-top: 12px">
      <van-cell title="Total Score" :value="`${totalScore} / ${maxTotal}`" />
      <van-cell title="Progress" :value="`${filledCount} / ${items.length} items`" />
    </van-cell-group>
  </template>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { getStoreTemplate, startInspection, submitInspection } from '../../api/inspection'

const route = useRoute()
const router = useRouter()
const template = ref(null)
const items = ref([])
const loading = ref(true)
const inspectionId = ref(null)
const currentStep = ref(0)
const scores = ref({})
const notes = ref({})
const submitting = ref(false)

const currentItem = computed(() => items.value[currentStep.value])
const totalScore = computed(() => Object.values(scores.value).reduce((a, b) => a + (b || 0), 0))
const maxTotal = computed(() => items.value.reduce((a, b) => a + (b.max_score || 0), 0))
const filledCount = computed(() => Object.keys(scores.value).filter(k => scores.value[k] > 0).length)

async function load() {
  try {
    const res = await getStoreTemplate(route.params.id)
    template.value = res.template || res
    items.value = res.items || []
    
    // Initialize scores
    items.value.forEach(item => {
      scores.value[item.id] = 0
      notes.value[item.id] = ''
    })

    // Start inspection
    const startRes = await startInspection({ template_id: route.params.id })
    inspectionId.value = startRes.inspection_id || startRes.id
  } catch {} finally { loading.value = false }
}

async function onSubmit() {
  submitting.value = true
  try {
    const results = items.value.map(item => ({
      check_item_id: item.id,
      score: scores.value[item.id] || 0,
      note: notes.value[item.id] || '',
      status: scores.value[item.id] >= item.max_score * 0.6 ? 'pass' : 'fail',
    }))

    await submitInspection(inspectionId.value, { results, total_score: totalScore.value })
    showToast({ message: 'Inspection submitted!', type: 'success' })
    router.push('/store/history')
  } catch {} finally { submitting.value = false }
}

onMounted(load)
</script>
