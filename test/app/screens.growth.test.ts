import { describe, expect, test } from 'vitest'
import { startOnPreMvpData, page, text, post, submitPace, dateAt, growthForm } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts.

describe('Inputs screen: ambiguity', () => {
  test('offers low, medium and high with their ranges, medium chosen, even where an epic was high before the MVP', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="radio" name="ambiguity" value="low"(?![^>]*checked)[^>]*>/)
    expect(html).toMatch(/<input type="radio" name="ambiguity" value="medium"[^>]*checked/)
    expect(html).toMatch(/<input type="radio" name="ambiguity" value="high"(?![^>]*checked)[^>]*>/)
    expect(text(html)).toContain('Low 1–1.5×')
    expect(text(html)).toContain('Medium 1–2×')
    expect(text(html)).toContain('High 1.5–3×')
  })

  test('choosing high shows it chosen, and the forecast says it used high ambiguity and finishes later', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = text(await page('/'))
    expect(before).toContain('Ambiguity: medium, growing 1–2×')

    const response = await post('/inputs/ambiguity', [['ambiguity', 'high']])

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(await page('/inputs')).toMatch(/<input type="radio" name="ambiguity" value="high"[^>]*checked/)
    const after = text(await page('/'))
    expect(after).toContain('Ambiguity: high, growing 1.5–3×')
    expect(Date.parse(dateAt(after, 85))).toBeGreaterThan(Date.parse(dateAt(before, 85)))
  })

  test('refuses a level that is not offered, saying why', async () => {
    await startOnPreMvpData()

    const response = await post('/inputs/ambiguity', [['ambiguity', 'extreme']])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Choose low, medium or high ambiguity.')
    expect(html).toMatch(/<input type="radio" name="ambiguity" value="medium"[^>]*checked/)
  })
})

describe('Inputs screen: growth', () => {
  test('shows the default ranges, each as times the tickets remaining', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')
    for (const [field, value] of Object.entries(Object.fromEntries(growthForm()))) {
      expect(html).toMatch(new RegExp(`name="${field}"[^>]*value="${value}"`))
    }
    expect(text(html)).toContain('× the tickets remaining')
    expect(text(html)).not.toContain('baseline')
  })

  test('explains how a range grows the work: each simulation picks one growth from it, before pace is applied', async () => {
    await startOnPreMvpData()

    expect(text(await page('/inputs'))).toContain(
      'Each simulation picks one growth from the range, every value in it equally likely, and multiplies the tickets remaining by it before working through them at the team’s pace. A wider range spreads the finish dates out.',
    )
  })

  test('saved ranges show on the Inputs screen, and the medium range moves the forecast', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = dateAt(text(await page('/')), 85)

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '3' }))

    expect(response.status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="medium-high"[^>]*value="3"/)
    expect(Date.parse(dateAt(text(await page('/')), 85))).toBeGreaterThan(Date.parse(before))
  })

  test('refused ranges say why, naming the level, keep what was typed, and change nothing', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    const before = text(await page('/'))

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '2.5', 'high-low': '4' }))

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('High ambiguity: the low end must not be above the high end.')
    expect(html).toMatch(/name="medium-high"[^>]*value="2.5"/)
    expect(html).toMatch(/name="high-low"[^>]*value="4"/)
    expect(text(html)).toContain('Medium 1–2×')
    expect(text(await page('/'))).toBe(before)
  })

  test('a refused range lands on the growth section, with why at its top', async () => {
    await startOnPreMvpData()

    const response = await post('/inputs/growth', growthForm({ 'high-low': '4' }))

    expect(response.status).toBe(400)
    const growth = (await response.text()).match(/<section[^>]*id="growth"[\s\S]*?<\/section>/)![0]
    expect(growth).toMatch(/<p class="error" role="alert">High ambiguity: the low end must not be above the high end.<\/p>[\s\S]*<table/)
  })

  test('offers no measured growth, even where it was adopted before the MVP', async () => {
    await startOnPreMvpData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/\/inputs\/growth\/medium|growth sample|measured/i)
    expect((await post('/inputs/growth/medium', [['source', 'measured']])).status).toBe(404)
  })
})
