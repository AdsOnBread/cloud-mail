<template>
  <header class="settings-head">
    <h1>Settings</h1>
    <nav aria-label="Settings sections">
      <router-link to="/settings" exact-active-class="current">General</router-link>
      <router-link to="/settings/labels" exact-active-class="current">Labels</router-link>
      <router-link to="/settings/accounts" exact-active-class="current">Accounts</router-link>
    </nav>
  </header>
</template>
<style scoped>
.settings-head{padding:16px 20px 0;color:var(--el-text-color-primary);border-bottom:1px solid var(--light-border-color)}
h1{font-size:22px;font-weight:400;margin:0 0 14px}.settings-head nav{display:flex;gap:16px}
a{color:inherit;padding:4px 2px 8px;font-size:14px;text-decoration:none}.current{color:var(--el-color-primary);font-weight:600;box-shadow:inset 0 -3px currentColor}
</style>
