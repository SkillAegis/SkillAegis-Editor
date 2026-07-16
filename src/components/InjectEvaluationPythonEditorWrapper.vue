<script setup>
    import PythonInjectValidation from '@/components/PythonInjectValidation.vue'
    import { onMounted, watch, ref } from 'vue'

    const model = defineModel()
    const code = ref('')

    onMounted(() => {
        updateLocalCopy()
    })

    function updateLocalCopy() {
        if (model.value[0] === undefined || typeof model.value[0] === 'string') {
            code.value = model.value[0]
        }
    }

    watch(model, async (newModel) => {
        updateLocalCopy()
    })

    watch(code, async (newCode, oldCode) => {
        model.value = [newCode]
    })
</script>

<template>
    <div>
        <PythonInjectValidation
            v-model="code"
        ></PythonInjectValidation>
    </div>
</template>
