import { renderHowItWorksScreen } from '../../../src/app/howItWorksScreen.js'
import { renderInputsScreen } from '../../../src/app/inputsScreen.js'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import { forecastingForTest } from '../../forecast/forecastingForTest.js'
import { entered, forecast } from './milestoneForecastScreenHarness.js'

// The screens whose shared page shell htmlPage.test.ts and htmlPage.feedback.test.ts check.

/** Each screen by its name in the sidebar and its path, drawn from a view Seam B gives. */
export const SCREENS = [
  ['Milestone forecast', '/', async () => renderMilestoneForecastScreen(forecast(await (await entered('100', ['4', '8'])).milestoneForecastView()))],
  ['Inputs', '/inputs', async () => renderInputsScreen(await (await forecastingForTest()).browserBuild().inputsScreen(), () => 'opening-1')],
  ['How it works', '/how-it-works', async () => renderHowItWorksScreen(await (await forecastingForTest()).howItWorksView())],
] as const
