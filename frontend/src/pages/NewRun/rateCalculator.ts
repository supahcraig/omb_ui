interface RateInput {
  producerRate: number
  topics: number
  messageSize: number
  subscriptionsPerTopic: number
  warmupDurationMinutes?: number
  testDurationMinutes?: number
}

export interface RateResult {
  produceMsgPerSec: number
  produceMBPerSec: number
  consumeMsgPerSec: number
  consumeMBPerSec: number
  totalDurationMinutes: number
}

export function calculateRates(input: RateInput): RateResult {
  const { producerRate, topics, messageSize, subscriptionsPerTopic,
    warmupDurationMinutes = 0, testDurationMinutes = 0 } = input
  const produceMsgPerSec = producerRate * topics
  const consumeMsgPerSec = produceMsgPerSec * subscriptionsPerTopic
  return {
    produceMsgPerSec,
    produceMBPerSec: (produceMsgPerSec * messageSize) / 1_048_576,
    consumeMsgPerSec,
    consumeMBPerSec: (consumeMsgPerSec * messageSize) / 1_048_576,
    totalDurationMinutes: warmupDurationMinutes + testDurationMinutes,
  }
}
