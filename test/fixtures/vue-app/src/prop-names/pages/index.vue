<template>
  <Card is-preview data-test="card">Draft</Card>
  <Field v-model="name" v-model:open="isOpen" />
  <Field v-model.trim="name" />
</template>
<script setup lang="ts">
import Card from "../components/Card.vue";
import Field from "../components/Field.vue";

const name = "";
const isOpen = false;
</script>
