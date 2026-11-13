<script setup lang="ts">
import { ref } from 'vue'
import { useSession } from '@/kernel/session'
import { storage } from '@/kernel/storage'
import { CHANGELOG, CHANGELOG_REV } from './log'

const session = useSession()
const open = ref(session.justLoggedIn && !storage.changelogDismissed(CHANGELOG_REV))

function agree() {
  session.justLoggedIn = false
  open.value = false
}

function never() {
  storage.dismissChangelog(CHANGELOG_REV)
  session.justLoggedIn = false
  open.value = false
}
</script>

<template>
  <div v-if="open" class="modal-back changelog-back" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
    <div class="card changelog">
      <h2 id="changelog-title">更新日志</h2>
      <ul class="changelog-list">
        <li v-for="item in CHANGELOG" :key="item.date">
          <time>{{ item.date }}</time>
          <span>{{ item.text }}</span>
        </li>
      </ul>
      <div class="changelog-actions">
        <button class="btn-ghost" type="button" @click="never">不再提示</button>
        <button class="btn" type="button" @click="agree">同意</button>
      </div>
    </div>
  </div>
</template>
