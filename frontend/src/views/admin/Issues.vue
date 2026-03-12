<template>
  <van-nav-bar title="Issue Tracker" />

  <van-tabs v-model:active="activeTab" @change="load">
    <van-tab title="Open" name="open" />
    <van-tab title="In Progress" name="in_progress" />
    <van-tab title="Resolved" name="resolved" />
    <van-tab title="All" name="" />
  </van-tabs>

  <van-pull-refresh v-model="refreshing" @refresh="load">
    <van-empty v-if="!loading && issues.length === 0" :description="`No ${activeTab || ''} issues`" />

    <van-cell-group inset v-for="issue in issues" :key="issue.id" style="margin-top: 12px">
      <van-cell :title="issue.title" :label="issue.description?.slice(0, 80)" @click="showDetail(issue)">
        <template #right-icon>
          <div style="text-align: right">
            <van-tag :type="severityType(issue.severity)">{{ issue.severity }}</van-tag>
            <br>
            <span style="font-size: 12px; color: #999">{{ issue.created_at?.slice(0, 10) }}</span>
          </div>
        </template>
      </van-cell>
    </van-cell-group>
  </van-pull-refresh>

  <van-floating-bubble icon="plus" @click="showCreate = true" />

  <!-- Create Issue -->
  <van-popup v-model:show="showCreate" position="bottom" round style="padding: 20px; max-height: 80vh; overflow-y: auto">
    <h3 style="margin: 0 0 16px">New Issue</h3>
    <van-form @submit="onCreate">
      <van-field v-model="newIssue.title" label="Title" :rules="[{ required: true }]" />
      <van-field v-model="newIssue.description" label="Description" type="textarea" rows="3" />
      <van-field v-model="newIssue.severity" label="Severity" is-link readonly @click="showSeverityPicker = true" />
      <van-field v-model.number="newIssue.inspection_id" label="Inspection ID" type="digit" />
      <van-button round block type="primary" native-type="submit" :loading="creating" style="margin-top: 16px">Create</van-button>
    </van-form>
  </van-popup>

  <!-- Severity Picker -->
  <van-popup v-model:show="showSeverityPicker" position="bottom" round>
    <van-picker :columns="['low', 'medium', 'high', 'critical']" @confirm="onSeverityPick" @cancel="showSeverityPicker = false" />
  </van-popup>

  <!-- Issue Detail -->
  <van-popup v-model:show="showDetailPopup" position="bottom" round style="padding: 20px; max-height: 80vh; overflow-y: auto">
    <template v-if="selectedIssue">
      <h3 style="margin: 0 0 8px">{{ selectedIssue.title }}</h3>
      <van-tag :type="severityType(selectedIssue.severity)">{{ selectedIssue.severity }}</van-tag>
      <van-tag style="margin-left: 8px">{{ selectedIssue.status }}</van-tag>
      <p style="color: #666; margin-top: 12px">{{ selectedIssue.description || 'No description' }}</p>
      <van-divider />
      <van-field v-model="updateStatus" label="Status" is-link readonly @click="showStatusPicker = true" />
      <van-field v-model="updateNote" label="Note" type="textarea" rows="2" placeholder="Add resolution note" />
      <van-button round block type="success" @click="onUpdateIssue" :loading="updating" style="margin-top: 12px">Update</van-button>
    </template>
  </van-popup>

  <van-popup v-model:show="showStatusPicker" position="bottom" round>
    <van-picker :columns="['open', 'in_progress', 'resolved', 'closed']" @confirm="onStatusPick" @cancel="showStatusPicker = false" />
  </van-popup>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showToast } from 'vant'
import { getIssues, createIssue, updateIssue } from '../../api/inspection'

const issues = ref([])
const loading = ref(true)
const refreshing = ref(false)
const activeTab = ref('open')

const showCreate = ref(false)
const creating = ref(false)
const newIssue = ref({ title: '', description: '', severity: 'medium', inspection_id: null })
const showSeverityPicker = ref(false)

const showDetailPopup = ref(false)
const selectedIssue = ref(null)
const updateStatus = ref('')
const updateNote = ref('')
const updating = ref(false)
const showStatusPicker = ref(false)

function severityType(s) {
  return { critical: 'danger', high: 'warning', medium: 'primary', low: 'default' }[s] || 'default'
}

async function load() {
  try {
    const params = activeTab.value ? { status: activeTab.value } : {}
    const res = await getIssues(params)
    issues.value = res.issues || res || []
  } catch {} finally { loading.value = false; refreshing.value = false }
}

function showDetail(issue) {
  selectedIssue.value = issue
  updateStatus.value = issue.status
  updateNote.value = ''
  showDetailPopup.value = true
}

function onSeverityPick({ selectedValues }) {
  newIssue.value.severity = selectedValues[0]
  showSeverityPicker.value = false
}

function onStatusPick({ selectedValues }) {
  updateStatus.value = selectedValues[0]
  showStatusPicker.value = false
}

async function onCreate() {
  creating.value = true
  try {
    await createIssue(newIssue.value)
    showToast({ message: 'Created', type: 'success' })
    showCreate.value = false
    newIssue.value = { title: '', description: '', severity: 'medium', inspection_id: null }
    await load()
  } catch {} finally { creating.value = false }
}

async function onUpdateIssue() {
  if (!selectedIssue.value) return
  updating.value = true
  try {
    await updateIssue(selectedIssue.value.id, { status: updateStatus.value, resolution_note: updateNote.value })
    showToast({ message: 'Updated', type: 'success' })
    showDetailPopup.value = false
    await load()
  } catch {} finally { updating.value = false }
}

onMounted(load)
</script>
