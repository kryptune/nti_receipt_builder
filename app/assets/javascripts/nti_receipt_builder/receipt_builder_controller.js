import { Controller } from "@hotwired/stimulus"

const MAX_ELEMENTS = 60
const Z_INDEX_MAX = 1000

const DEFAULT_DIMENSIONS = {
  variable: { widthMm: 40, heightMm: 5 },
  text: { widthMm: 40, heightMm: 6 },
  order_lines: { widthMm: 60, heightMm: 20 }
}

// Connects to data-controller="nrb-builder"
export default class extends Controller {
  static targets = [
    "layoutField",
    "elementCount",
    "paperSizeSelect",
    "widthInput",
    "heightInput",
    "orientationSelect",
    "heightModeSelect",
    "marginTopInput",
    "marginRightInput",
    "marginBottomInput",
    "marginLeftInput"
  ]

  static values = { layout: Array, presets: Object, collectionColumns: Array }
  static outlets = ["nrb-canvas", "nrb-properties"]

  initialize() {
    this.selectedId = null
    this.paletteDragHandler = null
  }

  // Stimulus calls this on connect and after every assignment to layoutValue — adding, patching,
  // moving, resizing and deleting all route through one of those, so the hidden field is never
  // stale.
  //
  // Serialising here rather than on submit is deliberate and load-bearing. Turbo builds the
  // request body in the FormSubmission constructor, which runs BEFORE turbo:submit-start is
  // dispatched from requestStarted(). A listener on that event writes the field after the body
  // has already been snapshotted, so every edit was dropped and the server silently re-saved the
  // layout the page was rendered with.
  layoutValueChanged() {
    this.serializeLayout()
  }

  disconnect() {
    this.cancelPaletteDrag()
  }

  nrbCanvasOutletConnected() {
    this.renderAll()
  }

  // Palette drag/drop

  // The pointerup is attached to `document` because the gesture can end anywhere on the page.
  // `{ once: true }` alone is not enough: if the pointerup never arrives — Turbo navigates away
  // mid-gesture, or the pointer is released outside the document — the handler stays on
  // `document` holding a closure over this controller, leaking one listener and one controller
  // per visit. So keep a reference and detach it in disconnect().
  cancelPaletteDrag() {
    if (!this.paletteDragHandler) return

    document.removeEventListener("pointerup", this.paletteDragHandler)
    this.paletteDragHandler = null
  }

  startPaletteDrag(event) {
    event.preventDefault()
    const type = event.params.type
    const key = event.params.key || null

    this.cancelPaletteDrag()
    this.paletteDragHandler = (upEvent) => {
      this.paletteDragHandler = null
      this.finishPaletteDrag(upEvent, type, key)
    }
    document.addEventListener("pointerup", this.paletteDragHandler, { once: true })
  }

  finishPaletteDrag(event, type, key) {
    if (this.layoutValue.length >= MAX_ELEMENTS) {
      this.showLimitReachedMessage()
      return
    }

    const dimensions = DEFAULT_DIMENSIONS[type] || DEFAULT_DIMENSIONS.variable
    let position = { xMm: 0, yMm: 0 }

    if (this.hasNrbCanvasOutlet) {
      const canvas = this.nrbCanvasOutlet
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const droppedOnPaper = target && target.closest('[data-nrb-canvas-target="paper"]')

      const raw = droppedOnPaper
        ? canvas.pointToMm(event.clientX, event.clientY)
        : canvas.centerMm(dimensions.widthMm, dimensions.heightMm)

      position = canvas.clampPosition(raw.xMm, raw.yMm, dimensions.widthMm, dimensions.heightMm)
    }

    this.addElement(type, key, position, dimensions)
  }

  addElement(type, key, position, dimensions) {
    const element = {
      id: crypto.randomUUID(),
      type,
      x_mm: position.xMm,
      y_mm: position.yMm,
      width_mm: dimensions.widthMm,
      height_mm: dimensions.heightMm,
      z_index: this.nextZIndex(),
      visible: true
    }

    if (type === "variable") {
      element.styles = this.defaultStyles()
      element.variable_key = key
      element.fallback = ""
      element.prefix = ""
      element.suffix = ""
    } else if (type === "text") {
      element.styles = this.defaultStyles()
      element.text = "New text"
    } else {
      element.config = this.defaultOrderLinesConfig()
    }

    this.layoutValue = [...this.layoutValue, element]
    this.selectElement(element.id)
  }

  defaultStyles() {
    return { font_size_pt: 10, font_weight: "normal", text_align: "left", line_height: 1.2 }
  }

  // Columns come from the host's variables class, not from here. Hardcoding keys would emit a
  // layout the server-side validator rejects for any host whose collection differs.
  defaultOrderLinesConfig() {
    return {
      show_header: true,
      row_spacing_mm: 1.0,
      font_size_pt: 8,
      columns: this.collectionColumnsValue.map((column) => ({
        key: column.key,
        label: column.label,
        width_mm: column.width_mm,
        align: column.align
      }))
    }
  }

  nextZIndex() {
    const max = this.layoutValue.reduce((acc, element) => Math.max(acc, element.z_index || 0), 0)
    return Math.min(Z_INDEX_MAX, max + 1)
  }

  showLimitReachedMessage() {
    if (window.Toast) window.Toast.warning(`You can add up to ${MAX_ELEMENTS} elements per template.`)
  }

  // Selection

  elementSelected(event) {
    this.selectElement(event.detail.id)
  }

  deselect() {
    this.selectElement(null)
  }

  selectElement(id) {
    if (id === this.selectedId) return

    this.selectedId = id
    this.renderAll()
    this.syncProperties()
  }

  syncProperties() {
    if (!this.hasNrbPropertiesOutlet) return

    const element = this.selectedId ? this.layoutValue.find((candidate) => candidate.id === this.selectedId) : null
    this.nrbPropertiesOutlet.render(element || null)
  }

  // Geometry / property changes

  elementMoved(event) {
    this.applyPatch(event.detail.id, { x_mm: event.detail.xMm, y_mm: event.detail.yMm })
  }

  elementResized(event) {
    this.applyPatch(event.detail.id, {
      x_mm: event.detail.xMm,
      y_mm: event.detail.yMm,
      width_mm: event.detail.widthMm,
      height_mm: event.detail.heightMm
    })
  }

  propertiesChanged(event) {
    this.applyPatch(event.detail.id, event.detail.patch, { refreshProperties: false })
  }

  applyPatch(id, patch, { refreshProperties = true } = {}) {
    this.layoutValue = this.layoutValue.map((element) => (element.id === id ? this.mergePatch(element, patch) : element))
    this.renderAll()
    if (refreshProperties && id === this.selectedId) this.syncProperties()
  }

  mergePatch(element, patch) {
    const merged = { ...element, ...patch }
    if (patch.styles) merged.styles = { ...(element.styles || {}), ...patch.styles }
    if (patch.config) merged.config = { ...(element.config || {}), ...patch.config }
    return merged
  }

  removeSelected(event) {
    const id = (event && event.detail && event.detail.id) || this.selectedId
    if (!id) return

    this.layoutValue = this.layoutValue.filter((element) => element.id !== id)
    if (this.selectedId === id) this.selectedId = null
    this.renderAll()
    this.syncProperties()
  }

  // Settings panel reactivity

  settingsChanged() {
    const canvas = this.hasNrbCanvasOutlet ? this.nrbCanvasOutlet : null

    const widthInput = this.hasWidthInputTarget ? parseFloat(this.widthInputTarget.value) : NaN
    const heightInput = this.hasHeightInputTarget ? parseFloat(this.heightInputTarget.value) : NaN
    const orientation = this.hasOrientationSelectTarget ? this.orientationSelectTarget.value : "portrait"

    let widthValue = widthInput
    let heightValue = heightInput

    if (!Number.isNaN(widthValue) && !Number.isNaN(heightValue)) {
      if (orientation === "landscape") {
        widthValue = Math.max(widthInput, heightInput)
        heightValue = Math.min(widthInput, heightInput)
      } else {
        widthValue = Math.min(widthInput, heightInput)
        heightValue = Math.max(widthInput, heightInput)
      }
    }

    if (this.hasWidthInputTarget && !Number.isNaN(widthValue)) this.widthInputTarget.value = String(widthValue)
    if (this.hasHeightInputTarget && !Number.isNaN(heightValue)) this.heightInputTarget.value = String(heightValue)

    if (!canvas) return

    if (this.hasWidthInputTarget && !Number.isNaN(widthValue)) canvas.widthMmValue = widthValue
    if (this.hasHeightInputTarget && !Number.isNaN(heightValue)) canvas.heightMmValue = heightValue
    if (this.hasHeightModeSelectTarget) canvas.heightModeValue = this.heightModeSelectTarget.value
    if (this.hasMarginTopInputTarget) canvas.marginTopMmValue = parseFloat(this.marginTopInputTarget.value) || 0
    if (this.hasMarginRightInputTarget) canvas.marginRightMmValue = parseFloat(this.marginRightInputTarget.value) || 0
    if (this.hasMarginBottomInputTarget) canvas.marginBottomMmValue = parseFloat(this.marginBottomInputTarget.value) || 0
    if (this.hasMarginLeftInputTarget) canvas.marginLeftMmValue = parseFloat(this.marginLeftInputTarget.value) || 0
  }

  paperPresetChanged() {
    const preset = this.presetsValue[this.paperSizeSelectTarget.value]
    if (!preset) return

    if (this.hasWidthInputTarget) this.widthInputTarget.value = preset.width_mm
    if (this.hasHeightInputTarget) this.heightInputTarget.value = preset.height_mm
    if (this.hasOrientationSelectTarget) this.orientationSelectTarget.value = preset.orientation

    this.settingsChanged()
  }

  // Rendering / serialization

  renderAll() {
    if (this.hasNrbCanvasOutlet) {
      this.nrbCanvasOutlet.renderElements(this.layoutValue, this.selectedId)
    }
    this.updateElementCount()
  }

  updateElementCount() {
    if (!this.hasElementCountTarget) return
    const count = this.layoutValue.length
    this.elementCountTarget.textContent = `${count} element${count === 1 ? "" : "s"}`
  }

  // Guarded because layoutValueChanged fires during initialization, before targets connect. The
  // field is server-rendered with the current layout, so a skipped first call loses nothing.
  serializeLayout() {
    if (!this.hasLayoutFieldTarget) return

    this.layoutFieldTarget.value = JSON.stringify(this.layoutValue)
  }

  // Last line of defence at submit time, for a layout mutated in place without reassigning
  // layoutValue. `new FormData(form)` dispatches formdata on the form, so this runs while Turbo
  // is still assembling the body — early enough to change what is sent, which is exactly what
  // turbo:submit-start was not.
  writeLayoutToFormData(event) {
    if (!this.hasLayoutFieldTarget) return

    event.formData.set(this.layoutFieldTarget.name, JSON.stringify(this.layoutValue))
  }

  // Panel toggles: show/hide overlay panels above the canvas. Panels have ids so
  // the topbar buttons can toggle them without restructuring the DOM.
  togglePanelById(id) {
    const el = document.getElementById(id)
    if (!el) return
    el.classList.toggle('open')
  }

  toggleElements() {
    this.togglePanelById('receipt-elements-panel')
    document.getElementById('receipt-settings-panel')?.classList.remove('open')
  }

  toggleSettings() {
    this.togglePanelById('receipt-settings-panel')
    document.getElementById('receipt-elements-panel')?.classList.remove('open')
  }

  toggleProperties() {
    this.togglePanelById('receipt-properties-panel')
  }
}
