import { describe, it, expect } from 'vitest'
import { calculateRates } from '../pages/NewRun/rateCalculator'

describe('calculateRates', () => {
  it('calculates produce rate and MB/s', () => {
    const r = calculateRates({ producerRate: 10000, topics: 1, messageSize: 1024, subscriptionsPerTopic: 1 })
    expect(r.produceMsgPerSec).toBe(10000)
    expect(r.produceMBPerSec).toBeCloseTo(9.77, 1)
  })

  it('calculates consume rate with multiple subscriptions', () => {
    const r = calculateRates({ producerRate: 10000, topics: 1, messageSize: 1024, subscriptionsPerTopic: 2 })
    expect(r.consumeMsgPerSec).toBe(20000)
    expect(r.consumeMBPerSec).toBeCloseTo(19.53, 1)
  })

  it('scales with topic count', () => {
    const r = calculateRates({ producerRate: 1000, topics: 3, messageSize: 512, subscriptionsPerTopic: 1 })
    expect(r.produceMsgPerSec).toBe(3000)
  })

  it('calculates total duration in minutes', () => {
    const r = calculateRates({ producerRate: 1000, topics: 1, messageSize: 1024, subscriptionsPerTopic: 1,
      warmupDurationMinutes: 5, testDurationMinutes: 20 })
    expect(r.totalDurationMinutes).toBe(25)
  })
})
