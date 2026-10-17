<template>
  <el-config-provider :locale="en">
    <router-view />
  </el-config-provider>
</template>
<script setup>
import en from 'element-plus/es/locale/lang/en';
import('@/icons/index.js')
</script>
