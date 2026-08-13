import { Controller } from "@hotwired/stimulus"

const PX_PER_MM_AT_100 = 96 / 25.4
const MIN_ELEMENT_DIMENSION_MM = 1.0
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.0
const ZOOM_STEP = 0.1
// Keep in sync with NtiReceiptBuilder::Presenters::Collection.
const MM_PER_PT = 0.3528
const LINE_HEIGHT_FACTOR = 1.25

// Connects to data-controller="nrb-canvas"
export default class extends Controller {
  static targets = ["viewport", "paper", "marginGuides", "elementsLayer", "zoomRange", "zoomLabel"]

  static values = {
    widthMm: Number,
    heightMm: Number,
    heightMode: String,
    marginTopMm: Number,
    marginRightMm: Number,
    marginBottomMm: Number,
    marginLeftMm: Number,
    gridMm: Number,
    zoom: { type: Number, default: 1 },
    variableLabels: Object
  }

  connect() {
    this.updatePaperSize()
    this.updateMarginGuides()
    this.applyZoom()
  }

  get pxPerMm() {
    return PX_PER_MM_AT_100 * this.zoomValue
  }

  toPx(mm) {
    return mm * this.pxPerMm
  }

  toMm(px) {
    return px / this.pxPerMm
  }

  round(mm) {
    return Math.round(mm * 100) / 100
  }

  snap(mm) {
    const grid = this.gridMmValue || 1
    return this.round(Math.round(mm / grid) * grid)
  }

  clampPosition(xMm, yMm, widthMm, heightMm) {
    const maxX = Math.max(0, this.widthMmValue - widthMm)
    const clampedX = Math.min(Math.max(0, xMm), maxX)

    let clampedY = Math.max(0, yMm)
    if (this.heightModeValue !== "content") {
      const maxY = Math.max(0, this.heightMmValue - heightMm)
      clampedY = Math.min(clampedY, maxY)
    }

    return { xMm: this.round(clampedX), yMm: this.round(clampedY) }
  }

  clampSize(widthMm, heightMm, xMm, yMm) {
    const maxWidth = Math.max(MIN_ELEMENT_DIMENSION_MM, this.widthMmValue - xMm)
    const clampedWidth = Math.min(Math.max(MIN_ELEMENT_DIMENSION_MM, widthMm), maxWidth)

    let clampedHeight = Math.max(MIN_ELEMENT_DIMENSION_MM, heightMm)
    if (this.heightModeValue !== "content") {
      const maxHeight = Math.max(MIN_ELEMENT_DIMENSION_MM, this.heightMmValue - yMm)
      clampedHeight = Math.min(clampedHeight, maxHeight)
    }

    return { widthMm: this.round(clampedWidth), heightMm: this.round(clampedHeight) }
  }

  pointToMm(clientX, clientY) {
    const rect = this.paperTarget.getBoundingClientRect()
    const xMm = this.toMm(clientX - rect.left)
    const yMm = this.toMm(clientY - rect.top)

    return {
      xMm: this.round(Math.max(0, Math.min(xMm, this.widthMmValue))),
      yMm: this.round(Math.max(0, Math.min(yMm, this.heightMmValue)))
    }
  }

  centerMm(widthMm, heightMm) {
    return {
      xMm: this.round(Math.max(0, (this.widthMmValue - widthMm) / 2)),
      yMm: this.round(Math.max(0, (this.heightMmValue - heightMm) / 2))
    }
  }

  // paperClicked() {
  //   this.dispatch("deselect", { prefix: "receipt-canvas", bubbles: true })
  //   // Close any open overlay panels when clicking on the paper, like dismissing
  //   // a modal or side panels in design tools.
  //   ;['receipt-elements-panel', 'receipt-settings-panel', 'receipt-properties-panel'].forEach((id) => {
  //     const el = document.getElementById(id)
  //     if (el) el.classList.remove('open')
  //   })
  // }

  zoomChanged(event) {
    this.setZoom(parseFloat(event.target.value))
  }

  zoomIn() {
    this.setZoom(this.zoomValue + ZOOM_STEP)
  }

  zoomOut() {
    this.setZoom(this.zoomValue - ZOOM_STEP)
  }

  setZoom(value) {
    const nextValue = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
    this.zoomValue = Number(nextValue.toFixed(1))
  }

  zoomValueChanged(value) {
    if (this.hasZoomLabelTarget) this.zoomLabelTarget.textContent = `${Math.round(value * 100)}%`
    if (this.hasZoomRangeTarget) this.zoomRangeTarget.value = String(value)
    this.applyZoom()
  }

  widthMmValueChanged() {
    this.updatePaperSize()
  }

  heightMmValueChanged() {
    this.updatePaperSize()
  }

  heightModeValueChanged() {
    this.updatePaperSize()
  }

  marginTopMmValueChanged() {
    this.updateMarginGuides()
  }

  marginRightMmValueChanged() {
    this.updateMarginGuides()
  }

  marginBottomMmValueChanged() {
    this.updateMarginGuides()
  }

  marginLeftMmValueChanged() {
    this.updateMarginGuides()
  }

  applyZoom() {
    if (!this.hasPaperTarget) return
    this.paperTarget.style.zoom = String(this.zoomValue)
  }

  updatePaperSize() {
    if (!this.hasPaperTarget) return
    this.paperTarget.style.width = `${this.widthMmValue}mm`
    this.paperTarget.style.height = this.heightModeValue === "content" ? "auto" : `${this.heightMmValue}mm`
    this.paperTarget.style.minHeight = this.heightModeValue === "content" ? `${this.heightMmValue}mm` : ""
  }

  updateMarginGuides() {
    if (!this.hasMarginGuidesTarget) return
    this.marginGuidesTarget.style.top = `${this.marginTopMmValue}mm`
    this.marginGuidesTarget.style.right = `${this.marginRightMmValue}mm`
    this.marginGuidesTarget.style.bottom = `${this.marginBottomMmValue}mm`
    this.marginGuidesTarget.style.left = `${this.marginLeftMmValue}mm`
  }

  renderElements(layout, selectedId) {
    if (!this.hasElementsLayerTarget) return

    this.elementsLayerTarget.innerHTML = ""
    const sorted = [...layout].sort((a, b) => (a.z_index || 0) - (b.z_index || 0))
    sorted.forEach((element) => {
      this.elementsLayerTarget.appendChild(this.buildElementNode(element, element.id === selectedId))
    })
  }

  buildElementNode(element, selected) {
    const node = document.createElement("div")
    node.setAttribute("data-controller", "nrb-draggable")
    node.setAttribute("data-nrb-draggable-element-id-value", element.id)
    node.setAttribute("data-nrb-draggable-x-mm-value", element.x_mm)
    node.setAttribute("data-nrb-draggable-y-mm-value", element.y_mm)
    node.setAttribute("data-nrb-draggable-width-mm-value", element.width_mm)
    node.setAttribute("data-nrb-draggable-height-mm-value", element.height_mm)
    node.setAttribute("data-nrb-draggable-nrb-canvas-outlet", `#${this.element.id}`)
    node.setAttribute("data-action", "pointerdown->nrb-draggable#dragStart")

    node.classList.add("nrb-receipt-element", `nrb-receipt-element--${element.type}`)
    if (selected) node.classList.add("nrb-receipt-element--selected")
    if (element.visible === false) node.classList.add("nrb-receipt-element--hidden")

    node.style.left = `${element.x_mm}mm`
    node.style.top = `${element.y_mm}mm`
    node.style.width = `${element.width_mm}mm`
    node.style.height = `${element.height_mm}mm`
    node.style.zIndex = String(element.z_index || 0)

    const body = document.createElement("div")
    body.className = "nrb-receipt-element-body"
    this.renderElementContent(body, element)
    node.appendChild(body)

    const handle = document.createElement("div")
    handle.className = "nrb-receipt-resize-handle"
    handle.setAttribute("data-nrb-draggable-target", "resizeHandle")
    handle.setAttribute("data-action", "pointerdown->nrb-draggable#resizeStart")
    node.appendChild(handle)

    return node
  }

  renderElementContent(body, element) {
    if (element.type === "variable") {
      this.applyTextStyles(body, element.styles || {})
      const label = this.variableLabelsValue[element.variable_key] || element.variable_key || "Variable"
      body.textContent = `${element.prefix || ""}{${label}}${element.suffix || ""}`
    } else if (element.type === "text") {
      this.applyTextStyles(body, element.styles || {})
      body.textContent = element.text || ""
    } else {
      this.renderOrderLinesPlaceholder(body, element)
    }
  }

  applyTextStyles(body, styles) {
    body.style.fontSize = `${styles.font_size_pt || 10}pt`
    body.style.fontWeight = styles.font_weight || "normal"
    body.style.textAlign = styles.text_align || "left"
    body.style.lineHeight = styles.line_height || 1.2
  }

  // Mirrors NtiReceiptBuilder::Presenters::Collection / _order_lines_element.html.erb —
  // same table markup and same layout math, so the canvas placeholder matches
  // what actually prints. Keep the constants below in sync with the presenter.
  renderOrderLinesPlaceholder(body, element) {
    const config = element.config || {}
    const columns = config.columns || []
    const fontSizePt = config.font_size_pt || 9
    const rowSpacingMm = config.row_spacing_mm != null ? config.row_spacing_mm : 1.0
    const totalWidthMm = columns.reduce((sum, column) => sum + (Number(column.width_mm) || 0), 0)

    const table = document.createElement("table")
    table.className = "nrb-receipt-order-lines-table"
    table.style.fontSize = `${fontSizePt}pt`
    table.style.lineHeight = `${fontSizePt * MM_PER_PT * LINE_HEIGHT_FACTOR}mm`

    const colgroup = document.createElement("colgroup")
    columns.forEach((column) => {
      const col = document.createElement("col")
      col.style.width = `${this.columnWidthPct(column, columns.length, totalWidthMm)}%`
      colgroup.appendChild(col)
    })
    table.appendChild(colgroup)

    if (config.show_header !== false) {
      const thead = document.createElement("thead")
      const header = document.createElement("tr")
      header.className = "nrb-receipt-order-lines-header"
      columns.forEach((column) => header.appendChild(this.buildCell(column, column.label, rowSpacingMm, "th")))
      thead.appendChild(header)
      table.appendChild(thead)
    }

    const tbody = document.createElement("tbody")
    ;[1, 2].forEach(() => {
      const row = document.createElement("tr")
      columns.forEach((column) => row.appendChild(this.buildCell(column, "—", rowSpacingMm)))
      tbody.appendChild(row)
    })
    table.appendChild(tbody)

    body.appendChild(table)
  }

  columnWidthPct(column, columnCount, totalWidthMm) {
    if (totalWidthMm > 0) return ((Number(column.width_mm) || 0) / totalWidthMm) * 100

    return columnCount > 0 ? 100 / columnCount : 100
  }

  buildCell(column, text, rowSpacingMm, tag = "td") {
    const cell = document.createElement(tag)
    cell.style.textAlign = column.align || "left"
    cell.style.paddingBottom = `${rowSpacingMm}mm`
    cell.textContent = text
    return cell
  }
}
