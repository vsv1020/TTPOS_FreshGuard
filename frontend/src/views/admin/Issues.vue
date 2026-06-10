<template>
  <van-nav-bar title="Issue Tracker" />

  <van-tabs v-model:active="activeTab" @change="load">
    <van-tab title="All" name="" />
    <van-tab title="Open" name="open" />
    <van-tab title="In Progress" name="in_progress" />
    <van-tab title="Resolved" name="resolved" />
    <van-tab title="Closed" name="closed" />
  </van-tabs>

  <van-cell center title="Overdue only">
    <template #right-icon>
      <van-switch v-model="overdueOnly" size="20" @change="load" />
    </template>
  </van-cell>

  <van-pull-refresh v-model="refreshing" @refresh="load">
    <van-empty v-if="!loading && issues.length === 0" :description="`No ${activeTab || ''} issues`" />

    <van-cell-group inset v-for="issue in issues" :key="issue.id" style="margin-top: 12px">
      <van-cell :title="issue.title" :label="issue.description?.slice(0, 80)" @click="showDetail(issue)">
        <template #right-icon>
          <div style="text-align: right">
            <van-tag :type="severityType(issue.severity)">{{ issue.severity }}</van-tag>
            <van-tag v-if="issue.overdue" type="danger" style="margin-left: 4px">overdue</van-tag>
            <br>
            <span style="font-size: 12px; color: #999">{{ issue.created_at?.slice(0, 10) }}</span>
          </div>
        </template>
      </van-cell>
      <van-cell v-if="issue.assignee || issue.due_date">
        <template #title>
          <span v-if="issue.assignee" style="font-size: 12px; color: #666">Assignee: {{ issue.assignee }}</span>
        </template>
        <template #value>
          <span v-if="issue.due_date" :style="{ fontSize: '12px', color: issue.overdue ? '#ee0a24' : '#666' }">
            Due: {{ issue.due_date.slice(0, 10) }}
          </span>
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
      <van-field
        v-model="newIssue.storeName"
        label="Store"
        is-link readonly
        placeholder="Select store"
        :rules="[{ required: true, message: 'Store is required' }]"
        @click="showStorePicker = true"
      />
      <van-field v-model.number="newIssue.inspectionId" label="Inspection ID" type="digit" />
      <van-button round block type="primary" native-type="submit" :loading="creating" style="margin-top: 16px">Create</van-button>
    </van-form>
  </van-popup>

  <!-- Severity Picker -->
  <van-popup v-model:show="showSeverityPicker" position="bottom" round>
    <van-picker :columns="['low', 'medium', 'high', 'critical']" @confirm="onSeverityPick" @cancel="showSeverityPicker = false" />
  </van-popup>

  <!-- Store Picker -->
  <van-popup v-model:show="showStorePicker" position="bottom" round>
    <van-picker :columns="storeColumns" @confirm="onStorePick" @cancel="showStorePicker = false" />
  </van-popup>

  <!-- Issue Detail -->
  <van-popup v-model:show="showDetailPopup" position="bottom" round style="padding: 20px; max-height: 80vh; overflow-y: auto">
    <template v-if="selectedIssue">
      <h3 style="margin: 0 0 8px">{{ selectedIssue.title }}</h3>
      <van-tag :type="severityType(selectedIssue.severity)">{{ selectedIssue.severity }}</van-tag>
      <van-tag style="margin-left: 8px">{{ selectedIssue.status }}</van-tag>
      <van-tag v-if="selectedIssue.overdue" type="danger" style="margin-left: 8px">overdue</van-tag>
      <p style="color: #666; margin-top: 12px">{{ selectedIssue.description || 'No description' }}</p>
      <van-divider />
      <van-field v-model="editAssignee" label="Assignee" placeholder="Assign to..." />
      <van-field v-model="editDueDate" label="Due Date" is-link readonly placeholder="Set deadline" @click="showDuePicker = true" />
      <van-field v-model="updateNote" label="Note" type="textarea" rows="2" placeholder="Add resolution note" />
      <van-button round block type="primary" @click="onSaveIssue" :loading="updating" style="margin-top: 12px">Save</van-button>
      <van-button
        v-if="nextStatus(selectedIssue.status)"
        round block type="success"
        @click="onTransition"
        :loading="transitioning"
        style="margin-top: 12px"
      >
        {{ transitionLabel(selectedIssue.status) }}
      </van-button>
    </template>
  </van-popup>

  <!-- Due Date Picker -->
  <van-popup v-model:show="showDuePicker" position="bottom" round>
    <van-date-picker
      v-model="duePickerValue"
      title="Due Date"
      @confirm="onDuePick"
      @cancel="showDuePicker = false"
    />
  </van-popup>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showToast } from 'vant'
import { getIssues, createIssue, updateIssue, getStores } from '../../api/inspection'

// Backend stores/returns 'pending' (accepts 'open' only as an input alias).
const STATUS_FLOW = { pending: 'in_progress', open: 'in_progress', in_progress: 'resolved', resolved: 'closed' }
const TRANSITION_LABELS = { pending: 'Start Progress', open: 'Start Progress', in_progress: 'Mark Resolved', resolved: 'Close Issue' }

const issues = ref([])
const loading = ref(true)
const refreshing = ref(false)
const activeTab = ref('open')
const overdueOnly = ref(false)

const EMPTY_ISSUE = { title: '', description: '', severity: 'medium', storeId: null, storeName: '', inspectionId: null }

const showCreate = ref(false)
const creating = ref(false)
const newIssue = ref({ ...EMPTY_ISSUE })
const showSeverityPicker = ref(false)
const showStorePicker = ref(false)
const storeColumns = ref([])

const showDetailPopup = ref(false)
const selectedIssue = ref(null)
const editAssignee = ref('')
const editDueDate = ref('')
const updateNote = ref('')
const updating = ref(false)
const transitioning = ref(false)
const showDuePicker = ref(false)
const duePickerValue = ref([])

function severityType(s) {
  return { critical: 'danger', high: 'warning', medium: 'primary', low: 'default' }[s] || 'default'
}

function nextStatus(s) {
  return STATUS_FLOW[s] || null
}

function transitionLabel(s) {
  return TRANSITION_LABELS[s] || ''
}

async function load() {
  try {
    const params = {}
    if (activeTab.value) params.status = activeTab.value
    if (overdueOnly.value) params.overdue = true
    const res = await getIssues(params)
    issues.value = res.issues || res || []
  } catch {} finally { loading.value = false; refreshing.value = false }
}

function showDetail(issue) {
  selectedIssue.value = issue
  editAssignee.value = issue.assignee || ''
  editDueDate.value = issue.due_date ? issue.due_date.slice(0, 10) : ''
  duePickerValue.value = editDueDate.value
    ? editDueDate.value.split('-')
    : new Date().toISOString().slice(0, 10).split('-')
  updateNote.value = ''
  showDetailPopup.value = true
}

function onSeverityPick({ selectedValues }) {
  newIssue.value.severity = selectedValues[0]
  showSeverityPicker.value = false
}

async function loadStores() {
  try {
    const res = await getStores()
    storeColumns.value = (res.stores || []).map((s) => ({
      text: s.brandName ? `${s.brandName} / ${s.name}` : s.name,
      value: s.id
    }))
  } catch {}
}

function onStorePick({ selectedOptions }) {
  const option = selectedOptions[0]
  if (option) {
    newIssue.value.storeId = option.value
    newIssue.value.storeName = option.text
  }
  showStorePicker.value = false
}

function onDuePick({ selectedValues }) {
  editDueDate.value = selectedValues.join('-')
  showDuePicker.value = false
}

async function onCreate() {
  if (!newIssue.value.storeId) {
    showToast({ message: 'Please select a store', position: 'top' })
    return
  }
  creating.value = true
  try {
    const { title, description, severity, storeId, inspectionId } = newIssue.value
    await createIssue({ title, description, severity, storeId, inspectionId: inspectionId || null })
    showToast({ message: 'Created', type: 'success' })
    showCreate.value = false
    newIssue.value = { ...EMPTY_ISSUE }
    await load()
  } catch {} finally { creating.value = false }
}

async function onSaveIssue() {
  if (!selectedIssue.value) return
  updating.value = true
  try {
    const body = { assignee: editAssignee.value || null, dueDate: editDueDate.value || null }
    if (updateNote.value) body.resolution_note = updateNote.value
    await updateIssue(selectedIssue.value.id, body)
    showToast({ message: 'Saved', type: 'success' })
    showDetailPopup.value = false
    await load()
  } catch {} finally { updating.value = false }
}

async function onTransition() {
  if (!selectedIssue.value) return
  const next = nextStatus(selectedIssue.value.status)
  if (!next) return
  transitioning.value = true
  try {
    const body = { status: next }
    if (updateNote.value) body.resolution_note = updateNote.value
    await updateIssue(selectedIssue.value.id, body)
    showToast({ message: 'Updated', type: 'success' })
    showDetailPopup.value = false
    await load()
  } catch {} finally { transitioning.value = false }
}

onMounted(() => {
  load()
  loadStores()
})
</script>
