<template>
  <div class="card">
    <slot/>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();
</script>
