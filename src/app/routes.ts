import { choiceKindOf } from '../connectors/connector.js'
import { connectionView, submitConnection, type Connecting, type ConnectionEdit, type ConnectionView } from '../forecast/connection.js'
import { howItWorksView } from '../forecast/howItWorksView.js'
import { followRenamedMilestone } from '../forecast/milestoneRenamed.js'
import { submitSkip, type SkipEdit, type Skipping } from '../forecast/skippedPeriods.js'
import {
  queryStepView,
  searchedChoiceList,
  submitStepQuery,
  type StepQueryEdit,
  type QueryStepOpening,
  type QueryStepping,
  type RefusedQuery,
} from '../forecast/queryStep.js'
import type { Connector } from '../connectors/connector.js'
import { inputsView, submitInputs, type InputsView, type NextScreen } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { openSetup, submitSetup, type SetupContext, type SetupEdit } from '../forecast/setup.js'
import { submitReadAgain } from '../forecast/setupReads.js'
import type { TrackerReads } from '../forecast/trackerReads.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from '../forecast/settings.js'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'
import { CONNECT_FORMS } from './connectSection.js'
import { renderHowItWorksScreen } from './howItWorksScreen.js'
import { INPUTS_FORMS, PACE_TRACKER_PATH, renderInputsScreen, SKIP_FORMS, type ShownStep } from './inputsScreen.js'
import { CAPACITY_OPEN, CAPACITY_OPEN_PATH, FORECAST_FORMS, renderMilestoneForecastScreen } from './milestoneForecastScreen.js'
import {
  choiceListHtml,
  COMPARABLE_WORK_STEP,
  CONFIRMING_BACK,
  KIND_FIELD,
  MILESTONE_STEP,
  OPEN_FIELD,
  STEP_FORMS,
  STEP_SECTIONS,
  type StepSection,
} from './queryStepSection.js'
import { SETUP_FORMS, SETUP_PATHS, SETUP_STEP_PATHS, STEP_FIELD } from './setupSection.js'
import { CANDIDATES_PATH, candidatesHtml, choicesAsked, keepOpening, OPENING_FIELD, openingKept } from './candidatesSection.js'
import { openCandidates, type CandidatesAt } from '../forecast/candidates.js'
import type { AppContext, Reply, Request } from './appContext.js'

/** What every route reads first: the settings, and the path asked for. */
interface Routing {
  settings: ForecastSettings
  pathname: string
  searchParams: URLSearchParams
}

function routing(request: Request): Routing {
  const { pathname, searchParams } = new URL(request.path, 'http://app')
  return { settings: DEFAULT_SETTINGS, pathname, searchParams }
}

/** A request's routing once the one team is added. */
type TeamRouting = Routing & { team: Team }

/** The Milestone forecast screen at `/`, the Inputs screen at `/inputs` and How it works at `/how-it-works`; not found for everything else. */
export function route(request: Request, context: AppContext): Reply {
  const { storage, today, connecting } = context
  const routed = routing(request)
  const { settings, pathname, searchParams } = routed
  const team = storage.teams()[0]
  if (request.method === 'GET' && pathname === '/') {
    const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
    const view: MilestoneForecastView = team
      ? milestoneForecastView(storage, team.id, settings, today(), { capacityOpen, tracker: trackerReads(context) })
      : { kind: 'empty' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (request.method === 'GET' && pathname === '/how-it-works') {
    return { kind: 'html', status: 200, html: renderHowItWorksScreen(howItWorksView(settings)) }
  }
  if (!team) return { kind: 'notFound' }
  const connection = connectionView(connecting, team.id)
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) {
    return {
      kind: 'html',
      status: 200,
      html: renderInputsScreen(inputsView(storage, team.id, settings, today(), { tracker: trackerReads(context) }), connection),
    }
  }
  const submitted = submitForm(request, context, { ...routed, team })
  if (submitted?.kind !== 'inputs') return submitted ?? { kind: 'notFound' }
  return { kind: 'html', status: submitted.status, html: renderInputsScreen(submitted.view, connection), path: SCREEN_PATHS.inputs }
}

/**
 * What a post of an Inputs or Milestone forecast form is answered with: a redirect to the next screen, the Milestone
 * forecast screen refused, or the Inputs screen's view to show (`inputs`), refused or saved in place, which the caller
 * shows beside the setup steps it has. None for any other request.
 */
type FormReply = Reply | { kind: 'inputs'; status: number; view: InputsView }

function submitForm(request: Request, context: AppContext, { team, settings, pathname, searchParams }: TeamRouting): FormReply | undefined {
  const { storage, today } = context
  const tracker = trackerReads(context)
  const readForm = request.method === 'POST' ? (INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)) : undefined
  if (!readForm) return undefined
  // the Capacity section's open state travels in the URL, and its forms carry it
  const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
  const submitted = submitInputs(storage, team.id, settings, today(), readForm(request.form ?? new URLSearchParams()), { capacityOpen, tracker })
  // a form from the open Capacity section goes back to the screen with it open
  const pathOf = (screen: NextScreen): string => (screen === 'forecast' && capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen])
  if (!submitted.saved) {
    if (submitted.screen === 'inputs') return { kind: 'inputs', status: 400, view: submitted.view }
    return { kind: 'html', status: 400, html: renderMilestoneForecastScreen(submitted.view), path: pathOf(submitted.screen) }
  }
  if (request.saveInPlace) return { kind: 'inputs', status: 200, view: inputsView(storage, team.id, settings, today(), { tracker }) }
  return { kind: 'redirect', location: pathOf(submitted.next) }
}

/**
 * The setup steps' requests, in the local server build: the Inputs screen, whose Milestone step asks the tracker for
 * its choices as it opens, and the Connect and Milestone steps' posts, each answered once the tracker has been asked,
 * so later than every other route; and the Inputs screen's own posts, so that the screen they answer with has the
 * Milestone step too. None for any other request, nor in the browser build, which has nothing to connect with.
 */
export function routeSetup(request: Request, context: AppContext): Promise<Reply> | undefined {
  const { connecting, storage } = context
  const team = storage.teams()[0]
  if (!connecting || !team) return undefined
  const reading = { ...connecting, milestoneInputs: storage, today: context.today(), timeZone: localTimeZone() }
  const setup: SetupRouting = { ...routing(request), team, request, context, connecting, reading }
  const { pathname } = setup
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) return inputsWithStep(setup)
  const searchedFor = request.method === 'GET' ? STEP_SECTIONS.find((section) => section.searchedChoicesPath === pathname) : undefined
  if (searchedFor) return searchedChoices(setup, searchedFor)
  if (request.method === 'GET' && pathname === CANDIDATES_PATH) return candidatesAsked(setup)
  const edited = request.method === 'POST' ? STEP_FORMS.get(pathname) : undefined
  if (edited) return queryEdited(setup, edited.section, edited.read)
  const readConnect = request.method === 'POST' ? CONNECT_FORMS.get(pathname) : undefined
  if (readConnect) return connected(setup, readConnect)
  const readSkip = request.method === 'POST' ? SKIP_FORMS.get(pathname) : undefined
  if (readSkip) return skipped(setup, readSkip)
  const readSetupEdit = request.method === 'POST' ? SETUP_FORMS.get(pathname) : undefined
  if (readSetupEdit) return setupSubmitted(setup, readSetupEdit(request.form ?? new URLSearchParams()))
  if (request.method === 'POST' && pathname === SETUP_PATHS.readAgain) return readAgain(setup)
  const named = milestoneName(storage, team.id)
  const submitted = submitForm(request, context, setup)
  if (!submitted) return undefined
  return renamed(setup, named, submitted)
}

/**
 * An Inputs or Milestone forecast form's reply, once a milestone renamed from `named` has moved the milestone query
 * to the new name where it follows it (`followRenamedMilestone`).
 */
async function renamed(setup: SetupRouting, named: string | undefined, submitted: FormReply): Promise<Reply> {
  const { reading, context, team, request } = setup
  const now = milestoneName(context.storage, team.id)
  if (named !== undefined && now !== undefined) await followRenamedMilestone(reading, team.id, { from: named, to: now }, context.now())
  if (submitted.kind !== 'inputs') return submitted
  // a save in place replaces only the sections saved, not the Milestone step, so its choices aren't asked for
  return inputsWithStep(setup, { status: submitted.status, view: submitted.view, unlisted: request.saveInPlace === true })
}

/** The milestone's name as saved; none until it has one. */
function milestoneName(storage: Storage, teamId: string): string | undefined {
  return storage.milestoneInputs(teamId)?.name
}

/** A setup step's request, in the local server build, with what it connects with. */
interface SetupRouting extends TeamRouting {
  request: Request
  context: AppContext
  connecting: Connecting
  /**
   * What setup and its steps read and save with, built once for the request: the connection, what is stored, the
   * milestone's inputs among it, today, and the EM's time zone.
   */
  reading: Skipping & SetupContext
}

/**
 * How the Inputs screen opens its query steps, beyond what the request asks: `unlisted`, every step asks the tracker
 * nothing (a save in place, which doesn't replace them); `refused`, the step whose query was just refused opens on
 * that refusal.
 */
interface StepsOpening {
  unlisted?: boolean
  refused?: { section: StepSection; query: RefusedQuery }
}

/**
 * The Inputs screen, with the Connect step (`connection`: as connected unless given) and the query steps (the
 * Milestone step and the Comparable work step), each opening as the request asks, or as `unlisted` or `refused` say;
 * served at `/inputs`, with `status` (200 unless given). `view` is the Inputs view to show, as saved unless given. The
 * steps list the same choices, so the tracker is asked for them once.
 */
async function inputsWithStep(
  { request, context, connecting, reading, team, settings, searchParams }: SetupRouting,
  { status = 200, view, connection, unlisted = false, refused }: { status?: number; view?: InputsView; connection?: ConnectionView } & StepsOpening = {},
): Promise<Reply> {
  // the Connect step's view is given only as a connect was refused
  const opening = {
    asked: searchParams.get(STEP_FIELD),
    ...(refused && { refused: refused.section.setupStep }),
    ...(connection && { refused: 'connect' as const }),
  }
  const setup = await openSetup(reading, team.id, opening, context.now())
  const stepping: QueryStepping = { ...listingOnce(connecting), milestoneInputs: context.storage, at: candidatesAt(context) }
  const steps: ShownStep[] = []
  // only the step shown is built, so the tracker is asked nothing once setup is closed
  for (const section of STEP_SECTIONS.filter(({ setupStep }) => setup.kind === 'steps' && setup.step === setupStep)) {
    const editing = searchParams.get(section.editing.name) === section.editing.value
    const opening: QueryStepOpening =
      refused?.section === section
        ? { refused: refused.query }
        : {
            editing,
            confirmingBack: editing && searchParams.get(CONFIRMING_BACK.name) === CONFIRMING_BACK.value,
            unlisted,
            opened: searchParams.getAll(OPEN_FIELD),
          }
    const view = await queryStepView(stepping, team.id, searchParams.get(section.findField) ?? '', opening, section.stepQuery)
    const candidates = view.kind === 'comparableWorkStep' && view.candidates
    steps.push({ section, view, ...(candidates && { openingId: keepOpening(candidates.opening) }) })
  }
  const html = renderInputsScreen(
    view ?? inputsView(context.storage, team.id, settings, reading.today, { tracker: reading }),
    connection ?? connectionView(connecting, team.id),
    steps,
    setup,
  )
  return { kind: 'html', status, html, ...(request.method === 'POST' && { path: SCREEN_PATHS.inputs }) }
}

/**
 * "Use these", Change, Cancel, skipping connecting or a source chosen at Check: back to the Inputs screen, at the step
 * setup goes on to (`submitSetup`), made or refused. Not found for a form Check never sends.
 */
async function setupSubmitted(setup: SetupRouting, edit: SetupEdit | undefined): Promise<Reply> {
  if (!edit) return { kind: 'notFound' }
  const { next } = await submitSetup(setup.reading, setup.team.id, edit)
  return { kind: 'redirect', location: next ? SETUP_STEP_PATHS[next] : SCREEN_PATHS.inputs }
}

/** Read again: back to the Inputs screen, read or failed, its summary saying why a read failed, the saved read in use. */
async function readAgain(setup: SetupRouting): Promise<Reply> {
  await submitReadAgain(setup.reading, setup.team.id, setup.context.now())
  return { kind: 'redirect', location: SCREEN_PATHS.inputs }
}

/** What the views read of the team's tracker: its connection and saved reads, dated in the EM's time zone; none in the browser build. */
function trackerReads({ connecting }: AppContext): TrackerReads | undefined {
  return connecting && { ...connecting, timeZone: localTimeZone() }
}

/** This computer's time zone, an IANA name: the EM's, which each finish is counted on its calendar day in. */
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** `connecting`, but its connectors ask the tracker for the milestone choices once between them, however often asked. */
function listingOnce(connecting: Connecting): Connecting {
  let listed: ReturnType<Connector['milestoneChoices']> | undefined
  return {
    ...connecting,
    connector: (connection, token) => {
      const connector = connecting.connector(connection, token)
      return {
        milestoneChoices: () => (listed ??= connector.milestoneChoices()),
        searchChoices: (kind, text) => connector.searchChoices(kind, text),
        read: (query, finishedSince) => connector.read(query, finishedSince),
      }
    },
  }
}

/** The candidates the Comparable work step's script asks for, in the opening it names: the candidates block alone. */
async function candidatesAsked({ context, connecting, team, searchParams }: SetupRouting): Promise<Reply> {
  const choices = choicesAsked(searchParams, choiceKindOf)
  if (!choices) return { kind: 'notFound' }
  const opening = openingKept(searchParams.get(OPENING_FIELD) ?? '', () => openCandidates(connecting, context.storage, team.id, candidatesAt(context)))
  const candidates = await opening.read(choices)
  return { kind: 'html', status: 200, html: candidatesHtml(candidates, searchParams.get(OPENING_FIELD) ?? '', COMPARABLE_WORK_STEP) }
}

/** When a query step opens, and its candidates are read: now, today, in this computer's time zone. */
function candidatesAt({ now, today }: AppContext): CandidatesAt {
  return { readAt: now(), today: today(), timeZone: localTimeZone() }
}

/** One kind's choices searched in the tracker, as a query step's script asks for them: that kind's list alone. */
async function searchedChoices({ connecting, team, searchParams }: SetupRouting, section: StepSection): Promise<Reply> {
  const kind = choiceKindOf(searchParams.get(KIND_FIELD) ?? '')
  const list = kind && (await searchedChoiceList(connecting, team.id, kind, searchParams.get(section.findField) ?? '', section.stepQuery))
  return list ? { kind: 'html', status: 200, html: choiceListHtml(list, section) } : { kind: 'notFound' }
}

/**
 * A change of a step's query (`section`'s): read again, then back to the step, still open for editing after a hand
 * edit, finding otherwise. A refused hand edit shows the Inputs screen again with why and the query as typed; a
 * change of the picks the tracker rejects, the step still finding, with why beside the chips that worked; going back
 * to finding from a query it would clear asks the EM to confirm that first.
 */
async function queryEdited(setup: SetupRouting, section: StepSection, readQueryEdit: (body: URLSearchParams) => StepQueryEdit | undefined): Promise<Reply> {
  const edit = readQueryEdit(setup.request.form ?? new URLSearchParams())
  if (!edit) return { kind: 'notFound' }
  // read at once, into setup's draft while setup is open
  const submitted = await submitStepQuery(setup.reading, setup.team.id, edit, setup.context.now(), section.stepQuery)
  if (submitted.kind === 'refused') return inputsWithStep(setup, { status: 400, refused: { section, query: submitted } })
  if (submitted.kind === 'confirmClear') return { kind: 'redirect', location: section.urls.confirmingBack }
  // a query edited by hand stays open for editing; every other change goes back to finding
  return { kind: 'redirect', location: edit.kind === 'editQuery' ? section.urls.editing : section.urls.finding }
}

/**
 * The tracker's periods skipped, or counted again, which may read the tracker further back; then back to its pace.
 * Refused, the Inputs screen again, saying why.
 */
async function skipped(setup: SetupRouting, readSkip: (body: URLSearchParams) => SkipEdit): Promise<Reply> {
  const { reading, context, team, request, settings } = setup
  const at = { settings, today: reading.today, readAt: context.now(), timeZone: reading.timeZone }
  const submitted = await submitSkip(reading, team.id, readSkip(request.form ?? new URLSearchParams()), at)
  if (!submitted.saved) return inputsWithStep(setup, { status: 400, ...(submitted.screen === 'inputs' && { view: submitted.view }) })
  return { kind: 'redirect', location: PACE_TRACKER_PATH }
}

/** A connect: on to the next setup step once saved; refused, the Inputs screen again with why, and the form as typed but for the token. */
async function connected(setup: SetupRouting, readConnect: (body: URLSearchParams) => ConnectionEdit): Promise<Reply> {
  const submitted = await submitConnection(setup.connecting, setup.team.id, readConnect(setup.request.form ?? new URLSearchParams()))
  if (submitted.saved) return { kind: 'redirect', location: SETUP_STEP_PATHS[submitted.next] }
  return inputsWithStep(setup, { status: 400, connection: submitted.view })
}

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
