<template>
  <input v-model="value" :disabled="!open" />
</template>
<script setup lang="ts">
const value = defineModel<string>();
const open = defineModel<boolean>("open", { default: false });
</script>
