<template>
  <v-row>
    <v-col>
      <v-btn @click="onClick">Click</v-btn>
      <v-data-table :items="items" />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
const items = [];
const onClick = () => {};
</script>
