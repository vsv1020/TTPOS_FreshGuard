<template>
  <van-nav-bar title="门店自检" left-arrow @click-left="$router.back()" />

  <van-loading v-if="loading" style="text-align: center; padding: 40px" />

  <!-- Template selection -->
  <template v-else-if="!inspectionId">
    <van-cell-group inset style="margin-top: 12px">
      <van-cell title="选择自检模板" />
    </van-cell-group>
    <van-cell-group inset v-for="t in templates" :key="t.id" style="margin-top: 8px">
      <van-cell :title="t.name" :label="t.description || ''" is-link @click="startSelfCheck(t.id)" />
    </van-cell-group>
  </template>

  <!-- Self-check form -->
  <template v-else-if="template && items.length">
    <van-steps :active="currentStep" style="padding: 16px 0" direction="vertical">
      <van-step v-for="(item, idx) in items" :key="item.id"
        :class="{ 'step-done': scores[item.id] !== undefined }">
        {{ item.name }}
      </van-step>
    </van-steps>

    <van-cell-group inset style="margin-top: 12px" v-if="currentItem">
      <van-cell :title="currentItem.name" :label="currentItem.description || ''" />

      <!-- Score input -->
      <van-cell :title="`评分 (满分 ${currentItem.max_score})`">
        <template #value>
          <van-rate v-model="scores[currentItem.id]"
            :count="currentItem.max_score"
            allow-half color="#ee0a24" void-icon="star" void-color="#eee" />
        </template>
      </van-cell>

      <!-- Pass/Fail toggle for boolean items -->
      <van-cell title="是否合格" v-if="currentItem.type === 'boolean'">
        <template #value>
          <van-switch v-model="passes[currentItem.id]"
            @change="v => scores[currentItem.id] = v ? currentItem.max_score : 0" />
        </template>
      </van-cell>

      <!-- Notes -->
      <van-field v-model="notes[currentItem.id]" label="备注" placeholder="问题描述（选填）" type="textarea" rows="2" />
    </van-cell-group>

    <!-- Navigation -->
    <div style="padding: 16px; display: flex; gap: 12px">
      <van-button v-if="currentStep > 0" plain round @click="currentStep--" style="flex: 1">上一项</van-button>
      <van-button v-if="currentStep < items.length - 1" type="primary" round @click="currentStep++" style="flex: 1">下一项</van-button>
      <van-button v-if="currentStep === items.length - 1" type="success" round @click="onSubmit" :loading="submitting" style="flex: 1">提交自检</van-button>
    </div>

    <!-- Progress summary -->
    <van-cell-group inset style="margin-top: 12px">
      <van-cell title="当前得分" :value="`${totalScore} / ${maxTotal}`" />
      <van-cell title="完成进度" :value="`${filledCount} / ${items.length}`" />
      <van-cell title="预估等级" :value="estimatedGrade" />
    </van-cell-group>
  </template>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showSuccessToast } from 'vant'
import { getStoreTemplates, getStoreTemplate } from '../../api/inspection'
import http from '../../api/http'

const router = useRouter()
const templates = ref([])
const template = ref(null)
const items = ref([])
const inspectionId = ref(null)
const loading = ref(true)
const submitting = ref(false)
const currentStep = ref(0)
const scores = ref({})
const notes = ref({})
const passes = ref({})

const currentItem = computed(() => items.value[currentStep.value])
const totalScore = computed(() => Object.values(scores.value).reduce((a, b) => a + (b || 0), 0))
const maxTotal = computed(() => items.value.reduce((a, b) => a + b.max_score, 0))
const filledCount = computed(() => Object.keys(scores.value).filter(k => scores.value[k] !== undefined).length)

const estimatedGrade = computed(() => {
  if (maxTotal.value === 0) return '-'
  const pct = (totalScore.value / maxTotal.value) * 100
  if (pct >= 90) return 'A ✅'
  if (pct >= 80) return 'B 👍'
  if (pct >= 70) return 'C ⚠️'
  if (pct >= 60) return 'D ⚠️'
  return 'F ❌'
})

async function loadTemplates() {
  try {
    const res = await getStoreTemplates()
    templates.value = res.templates || res || []
  } catch {} finally { loading.value = false }
}

async function startSelfCheck(templateId) {
  loading.value = true
  try {
    // Start self-check inspection
    const res = await http.post('/store/inspection/self-check/start', { templateId })
    inspectionId.value = res.id

    // Load template items
    const tpl = await getStoreTemplate(templateId)
    template.value = tpl.template || tpl
    items.value = template.value.items || []

    // Init scores
    items.value.forEach(item => {
      scores.value[item.id] = item.type === 'boolean' ? item.max_score : 0
      notes.value[item.id] = ''
    })
  } catch (e) {
    showToast('Failed to start self-check')
  } finally { loading.value = false }
}

async function onSubmit() {
  submitting.value = true
  try {
    const results = items.value.map(item => ({
      checkItemId: item.id,
      score: scores.value[item.id] || 0,
      note: notes.value[item.id] || '',
    }))

    const res = await http.post(`/store/inspection/self-check/${inspectionId.value}/submit`, { results })

    showSuccessToast(`自检完成！等级: ${res.grade} (${res.pct}%)`)
    router.push(`/store/scorecard/${inspectionId.value}`)
  } catch (e) {
    showToast('提交失败')
  } finally { submitting.value = false }
}

onMounted(loadTemplates)
</script>
