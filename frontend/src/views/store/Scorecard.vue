<template>
  <van-nav-bar title="巡检评分" left-arrow @click-left="$router.back()" />

  <van-loading v-if="loading" style="text-align: center; padding: 40px" />

  <template v-else-if="data">
    <!-- Grade card -->
    <div :class="['grade-card', `grade-${data.grade}`]">
      <div class="grade-letter">{{ data.grade }}</div>
      <div class="grade-score">{{ data.total_score }} / {{ data.max_score }}</div>
      <div class="grade-pct">{{ data.pct }}%</div>
      <div class="grade-label">{{ data.template_name || 'Inspection' }}</div>
    </div>

    <!-- Summary -->
    <van-cell-group inset style="margin-top: 12px" title="评分概览">
      <van-cell title="检查项总数" :value="data.summary.total" />
      <van-cell title="通过" :value="data.summary.passed" value-class="text-green" />
      <van-cell title="未通过" :value="data.summary.failed" value-class="text-red" />
      <van-cell title="严重不合格 (0分)" :value="data.summary.critical" value-class="text-red"
        v-if="data.summary.critical > 0" />
      <van-cell title="类型" :value="data.type === 'self_check' ? '门店自检' : '巡检'" />
      <van-cell title="完成时间" :value="data.completed_at || '-'" />
    </van-cell-group>

    <!-- Detail results -->
    <van-cell-group inset style="margin-top: 12px" title="明细">
      <van-cell v-for="r in data.results" :key="r.id"
        :title="r.item_name"
        :label="r.note || r.item_desc || ''"
        :value="`${r.score} / ${r.max_score}`"
        :value-class="r.score >= r.max_score * 0.6 ? 'text-green' : 'text-red'" />
    </van-cell-group>

    <!-- Actions -->
    <div style="padding: 16px">
      <van-button type="primary" round block @click="$router.push('/store/history')">查看历史</van-button>
    </div>
  </template>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import http from '../../api/http'

const route = useRoute()
const loading = ref(true)
const data = ref(null)

async function load() {
  try {
    data.value = await http.get(`/store/inspection/${route.params.id}/scorecard`)
  } catch {} finally { loading.value = false }
}

onMounted(load)
</script>

<style scoped>
.grade-card {
  margin: 16px;
  padding: 32px 24px;
  border-radius: 16px;
  text-align: center;
  color: white;
}
.grade-A { background: linear-gradient(135deg, #2a9d8f, #264653); }
.grade-B { background: linear-gradient(135deg, #2a9d8f, #457b9d); }
.grade-C { background: linear-gradient(135deg, #e9c46a, #f4a261); }
.grade-D { background: linear-gradient(135deg, #f4a261, #e76f51); }
.grade-F { background: linear-gradient(135deg, #e76f51, #d62828); }

.grade-letter { font-size: 64px; font-weight: 800; }
.grade-score { font-size: 24px; font-weight: 600; margin-top: 4px; }
.grade-pct { font-size: 18px; opacity: 0.8; }
.grade-label { font-size: 14px; opacity: 0.7; margin-top: 8px; }

.text-green { color: #2a9d8f !important; }
.text-red { color: #e76f51 !important; }
</style>
