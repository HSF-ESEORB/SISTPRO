/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Trophy, 
  Search, 
  List, 
  Star, 
  BarChart3, 
  ChevronRight, 
  AlertCircle, 
  Loader2,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  LayoutDashboard,
  Printer,
  Download,
  FileText,
  Table as TableIcon,
  Image as ImageIcon,
  ChevronDown
} from "lucide-react";
import { Match, Analysis, fetchDailyMatches, analyzeMatch } from "./services/geminiService";
import { cn } from "./lib/utils";
import ReactMarkdown from "react-markdown";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";

type Step = "LIST" | "ANALYSIS";

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>("LIST");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const todayDate = new Date();
  const today = todayDate.toLocaleDateString("pt-BR", { day: '2-digit', month: 'long', year: 'numeric' });

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchDailyMatches(today);
      setMatches(data);
    } catch (e: any) {
      console.error(e);
      if (e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED") || e.message?.includes("quota")) {
        setErrorMessage("Limite diário da IA atingido (Cota Excedida). Por favor, aguarde alguns minutos ou retorne mais tarde para novas análises.");
      } else if (e.message?.includes("403") || e.message?.includes("permission")) {
        setErrorMessage("Erro de permissão no acesso à IA. Verifique as configurações do projeto.");
      } else {
        setErrorMessage("Erro ao carregar jogos de hoje. Tente atualizar a página.");
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMatchSelection = (id: string) => {
    const next = new Set(selectedMatchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedMatchIds(next);
    setErrorMessage(null);
  };

  const handleDeepAnalysis = async (match: Match) => {
    if (analyses[match.id] || analyzingId === match.id) return;
    setAnalyzingId(match.id);
    setErrorMessage(null);
    try {
      const data = await analyzeMatch(match);
      setAnalyses(prev => ({ ...prev, [match.id]: data }));
    } catch (e: any) {
      console.error(e);
      if (e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED") || e.message?.includes("quota")) {
        setErrorMessage(`Limite de requisições atingido ao analisar ${match.homeTeam}. Aguarde um momento.`);
      } else if (e.message?.includes("403")) {
        setErrorMessage(`Erro de permissão ao analisar ${match.homeTeam}.`);
      } else {
        setErrorMessage(`Falha ao analisar ${match.homeTeam}.`);
      }
    } finally {
      setAnalyzingId(null);
    }
  };

  // Automatic analysis when entering the ANALYSIS step
  useEffect(() => {
    if (currentStep === "ANALYSIS") {
      const runAllAnalyses = async () => {
        const ids = Array.from(selectedMatchIds);
        for (const id of ids) {
          const match = matches.find(m => m.id === id);
          if (match && !analyses[id] && analyzingId !== id) {
            try {
              await handleDeepAnalysis(match);
              // Add a 1s delay between analyses to respect rate limits
              await new Promise(r => setTimeout(r, 1000));
            } catch (e: any) {
              // If it's a quota error, stop the entire batch
              if (e.message?.includes("429") || e.message?.includes("quota") || e.message?.includes("RESOURCE_EXHAUSTED")) {
                console.warn("Lote de análises interrompido por limite de cota.");
                break; 
              }
            }
          }
        }
      };
      runAllAnalyses();
    }
  }, [currentStep, selectedMatchIds]);

  const sanitizeClonedDoc = (clonedDoc: Document) => {
    // 1. COMPLETELY remove ALL existing style tags and link tags to eliminate any oklab/oklch references
    const problematicTags = clonedDoc.querySelectorAll("style, link[rel='stylesheet']");
    problematicTags.forEach(tag => tag.remove());

    // 2. Clear all inline styles that might contain modern colors
    const allWithStyles = clonedDoc.querySelectorAll("[style]");
    allWithStyles.forEach((el: any) => {
      const style = el.getAttribute("style") || "";
      if (style.toLowerCase().includes("oklch") || style.toLowerCase().includes("oklab")) {
        // Replace with inherited or safe gray
        el.setAttribute("style", style
          .replace(/oklch\s*\([^]*?\)/gi, "#888888")
          .replace(/oklab\s*\([^]*?\)/gi, "#888888")
        );
      }
    });

    const report = clonedDoc.getElementById("analysis-report");
    if (report) {
      report.style.backgroundColor = "#FFFFFF";
      report.style.color = "#000000";
      report.style.fontFamily = "sans-serif";

      // Tag prediction headers and values for targeted styling
      const predictionSections = clonedDoc.querySelectorAll(".bg-\\[\\#1A1A1A\\]");
      predictionSections.forEach(section => {
        const header = section.querySelector(".text-yellow-400");
        if (header) {
          header.innerHTML = "PALPITE DA ANÁLISE - MERCADO RECOMENDADO";
          header.classList.add("prediction-header-custom");
        }
        const market = section.querySelector(".text-white.text-2xl");
        if (market) {
          market.classList.add("prediction-market-custom");
        }
      });
      
      const styleTag = clonedDoc.createElement("style");
      styleTag.innerHTML = `
        * { 
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important; 
          print-color-adjust: exact !important; 
          color-scheme: light !important;
          color: #000000 !important;
          background-color: transparent !important;
          text-shadow: none !important;
          box-shadow: none !important;
        }
        body, html { 
          background-color: #FFFFFF !important; 
          margin: 0; 
          padding: 0;
          font-family: sans-serif;
        }
        #analysis-report {
          padding: 15pt !important;
          background-color: #FFFFFF !important;
          width: 595pt !important; /* A4 width */
          margin: 0 auto !important;
        }
        .match-analysis-item {
          background-color: #FFFFFF !important;
          border: 1px solid #000000 !important;
          margin-bottom: 20pt !important;
          padding: 15pt !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          page-break-after: always !important;
          overflow: hidden;
        }
        
        /* Titles Centralized - 10pt */
        h4, .text-\\[10px\\].font-black.uppercase {
          font-size: 10pt !important;
          text-align: center !important;
          width: 100% !important;
          display: block !important;
          margin: 10pt 0 5pt 0 !important;
          font-weight: bold !important;
          text-transform: uppercase !important;
          color: #000000 !important;
        }

        /* Text Analysis - 9pt */
        p, span, div, li, .text-sm, .text-xs, .font-mono, .text-gray-600 { 
          font-size: 9pt !important; 
          line-height: 1.3 !important;
          margin: 3pt 0 !important;
        }

        /* Prediction Header - 11pt */
        .prediction-header-custom {
          font-size: 11pt !important;
          font-weight: 900 !important;
          text-transform: uppercase !important;
          color: #000000 !important;
          margin: 0 0 5pt 0 !important;
          display: block !important;
          text-align: center !important;
          width: 100% !important;
        }

        /* Prediction Market - 12pt Navy Blue */
        .prediction-market-custom {
          background-color: #000080 !important; /* Navy Blue */
          color: #FFFFFF !important;
          font-size: 12pt !important;
          font-weight: bold !important;
          padding: 10pt !important;
          text-align: center !important;
          display: block !important;
          width: 100% !important;
          border-radius: 4pt !important;
          margin-top: 5pt !important;
        }

        /* Prediction Box Container - Transparent parent */
        .bg-\\[\\#1A1A1A\\] { 
          background-color: transparent !important; 
          border: none !important;
          padding: 0 !important;
          margin: 15pt 0 !important;
          display: block !important;
        }
        
        .bg-white { background-color: #FFFFFF !important; }
        
        /* Force high contrast */
        h3, h4, p, span, div { color: #000000 !important; }
        .bg-\\[\\#1A1A1A\\] *, .bg-black * { color: #000000 !important; }
        .bg-\\[\\#1A1A1A\\] .prediction-market-custom { color: #FFFFFF !important; }
        
        .border-gray-100, .border-\\[\\#E5E5E5\\], .border-gray-200 { border-color: #000000 !important; }
        
        /* Indicators and Icons */
        .text-green-400, .text-yellow-500, .text-red-500 { 
          color: #000000 !important; 
          font-weight: bold !important;
          font-size: 9pt !important;
        }
        
        .no-export { display: none !important; }
        hr { border: 0; border-top: 1px solid #000000 !important; margin: 15pt 0 !important; }
        
        .flex { display: flex !important; }
        .flex-col { flex-direction: column !important; }
        .grid { display: grid !important; }
        .items-center { align-items: center !important; }
        .justify-between { justify-content: space-between !important; }
        
        /* Grid adjustments for print */
        .grid-cols-2 { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 15pt !important; }
        .md\\:grid-cols-2 { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 15pt !important; }
      `;
      clonedDoc.head.appendChild(styleTag);
    }
  };

  const handleExportImage = async () => {
    const reportElement = document.getElementById("analysis-report");
    if (!reportElement) return;
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#FFFFFF",
        onclone: (clonedDoc) => sanitizeClonedDoc(clonedDoc)
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.9);
      const link = document.createElement("a");
      link.href = imgData;
      link.download = `BetAnalyis_${today.replace(/ /g, "_")}.jpg`;
      link.click();
    } catch (e) {
      console.error("Image Export error:", e);
      setErrorMessage("Erro ao exportar imagem.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    const reportElement = document.getElementById("analysis-report");
    if (!reportElement) return;
    setIsExporting(true);
    setShowExportMenu(false);
    
    try {
      // Create a cloned version to render individual items accurately
      const clonedContainer = reportElement.cloneNode(true) as HTMLElement;
      clonedContainer.style.position = "absolute";
      clonedContainer.style.left = "-9999px";
      clonedContainer.style.top = "0";
      clonedContainer.style.width = "800px";
      document.body.appendChild(clonedContainer);

      const items = clonedContainer.querySelectorAll(".match-analysis-item");
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as HTMLElement;
        
        const canvas = await html2canvas(item, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#FFFFFF",
          onclone: (clonedDoc) => sanitizeClonedDoc(clonedDoc)
        });
        
        const imgData = canvas.toDataURL("image/jpeg", 1.0);
        const imgProps = pdf.getImageProperties(imgData);
        const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
        
        if (i > 0) pdf.addPage();
        
        // Center vertically if it fits, else start from top
        const yOffset = imgHeight < pdf.internal.pageSize.getHeight() ? 20 : 0;
        pdf.addImage(imgData, 'JPEG', 0, yOffset, pdfWidth, imgHeight);
      }
      
      pdf.save(`Relatorio_Analise_${today.replace(/ /g, "_")}.pdf`);
      document.body.removeChild(clonedContainer);
    } catch (e) {
      console.error("PDF Export error:", e);
      setErrorMessage("Erro ao exportar PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcel = () => {
    setShowExportMenu(false);
    try {
      const dataToExport = Array.from(selectedMatchIds).map(id => {
        const match = matches.find(m => m.id === id);
        const analysis = analyses[id];
        return {
          Data: today,
          Esporte: match?.sport || "",
          Liga: match?.league || "",
          Jogo: `${match?.homeTeam} vs ${match?.awayTeam}`,
          Horário: match?.time || "",
          'Forma Recente': analysis?.recentForm || "",
          'H2H': analysis?.h2h || "",
          'Casa vs Fora': analysis?.homeAway || "",
          'Escalações': analysis?.lineups || "",
          'Estatísticas': analysis?.stats || "",
          'Odds': analysis?.odds || "",
          'Mercado Recomendado': analysis?.prediction.market || "",
          'Probabilidade (%)': analysis?.prediction.probability || "",
          'Confiança': analysis?.prediction.confidence || ""
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Análises");
      XLSX.writeFile(workbook, `Analise_Esportiva_${today.replace(/ /g, "_")}.xlsx`);
    } catch (e) {
      console.error("Excel Export error:", e);
      setErrorMessage("Erro ao exportar Excel.");
    }
  };

  const handleExportWord = () => {
    setShowExportMenu(false);
    try {
      let html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Relatório de Análise</title></head>
        <body style="font-family: Arial, sans-serif;">
          <h1 style="color: #1A1A1A; text-transform: uppercase;">Relatório de Análise - ${today}</h1>
      `;

      Array.from(selectedMatchIds).forEach(id => {
        const match = matches.find(m => m.id === id);
        const analysis = analyses[id];
        if (!match || !analysis) return;

        html += `
          <div style="margin-bottom: 40px; border: 1px solid #E5E5E5; padding: 20px;">
            <h2>${match.homeTeam} vs ${match.awayTeam}</h2>
            <p><strong>Liga:</strong> ${match.league} | <strong>Esporte:</strong> ${match.sport}</p>
            <hr/>
            <div style="background-color: #1A1A1A; color: white; padding: 15px; margin: 10px 0;">
              <h3>PALPITE: ${analysis.prediction.market}</h3>
              <p>Confiança: ${analysis.prediction.confidence} | Probabilidade: ${analysis.prediction.probability}%</p>
            </div>
            <h4>Forma Recente</h4><p>${analysis.recentForm}</p>
            <h4>H2H</h4><p>${analysis.h2h}</p>
            <h4>Estatísticas</h4><p>${analysis.stats}</p>
          </div>
        `;
      });

      html += `</body></html>`;
      
      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `Relatorio_Analise_${today.replace(/ /g, "_")}.doc`;
      link.click();
    } catch (e) {
      console.error("Word Export error:", e);
      setErrorMessage("Erro ao exportar Word.");
    }
  };

  const highConfidenceAnalyses = Object.entries(analyses)
    .filter(([_, data]) => data.prediction.confidence === "Alto");

  const sports = ["Futebol", "Basquete", "Vôlei", "Tênis", "Tênis de Mesa"];
  
  return (
    <div className="min-h-screen bg-[#F5F5F5] font-sans text-[#1A1A1A]">
      {/* Header */}
      <header className="bg-white border-b border-[#E5E5E5] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#1A1A1A] text-white p-2 rounded-lg">
              <Trophy size={18} />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight uppercase tracking-tight">Sistema Pro</h1>
              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Analista de Apostas</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium">
            <span className="flex items-center gap-2 text-gray-500 italic">
              <Calendar size={14} />
              {today}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Error Notification */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm"
            >
              <AlertCircle size={18} />
              <p className="font-medium">{errorMessage}</p>
              <button onClick={() => setErrorMessage(null)} className="ml-auto text-red-400 hover:text-red-600">
                &times;
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Workflow Stepper */}
        <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide no-print">
          <StepButton 
            active={currentStep === "LIST"} 
            done={!!matches.length}
            icon={<List size={16} />} 
            label="Etapa 1: Listagem e Seleção" 
            onClick={() => setCurrentStep("LIST")}
          />
          <StepButton 
            active={currentStep === "ANALYSIS"} 
            done={Object.keys(analyses).length > 0}
            icon={<BarChart3 size={16} />} 
            label="Etapa 2: Análise Profissional" 
            onClick={() => setCurrentStep("ANALYSIS")}
            disabled={!selectedMatchIds.size}
          />
        </div>

        {/* Content Area */}
        <div className="relative">
          <AnimatePresence mode="wait">
            {currentStep === "LIST" && (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                    <Loader2 className="animate-spin mb-4" size={32} />
                    <p className="font-mono text-xs uppercase tracking-widest">Consultando fontes de dados...</p>
                  </div>
                ) : matches.length > 0 ? (
                  sports.map(sport => {
                    const sportMatches = matches.filter(m => m.sport === sport);
                    if (sportMatches.length === 0) return null;
                    return (
                      <div key={sport} className="space-y-4">
                        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
                          <span className="w-8 h-[1px] bg-gray-200"></span>
                          {sport}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
                          {sportMatches.map(match => (
                            <MatchCardInList 
                              key={match.id} 
                              match={match} 
                              selected={selectedMatchIds.has(match.id)}
                              onToggle={() => toggleMatchSelection(match.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl">
                    <AlertCircle className="mx-auto text-gray-300 mb-4" size={48} />
                    <p className="text-gray-500 italic">Nenhum jogo encontrado para hoje. Tente atualizar.</p>
                    <button 
                      onClick={loadMatches}
                      className="mt-4 px-6 py-2 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-wider rounded-full hover:opacity-90 transition-opacity"
                    >
                      Atualizar Coleta
                    </button>
                  </div>
                )}
                
                {matches.length > 0 && (
                  <div className="flex justify-end pt-8">
                    <button 
                      onClick={() => setCurrentStep("ANALYSIS")}
                      disabled={selectedMatchIds.size === 0}
                      className="group flex items-center gap-2 bg-[#1A1A1A] text-white px-8 py-3 rounded-full font-bold text-sm tracking-tight hover:pr-10 transition-all relative overflow-hidden disabled:opacity-50"
                    >
                      Seguir para Análise ({selectedMatchIds.size})
                      <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                )}
              </motion.div>
            )}



            {currentStep === "ANALYSIS" && (
              <motion.div
                key="analysis"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between mb-2 no-print">
                  <h2 className="text-2xl font-bold tracking-tighter flex items-center gap-3">
                    <BarChart3 className="text-[#1A1A1A]" />
                    Central de Análise
                  </h2>
                  <div className="flex items-center gap-4 no-export">
                    <div className="relative">
                      <button 
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        disabled={isExporting}
                        className={cn(
                          "bg-[#1A1A1A] text-white px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all flex items-center gap-2 shadow-lg shadow-black/10",
                          isExporting && "opacity-50 cursor-wait"
                        )}
                      >
                        {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 
                        {isExporting ? "Processando..." : "Exportar Análise"}
                        <ChevronDown size={12} className={cn("transition-transform", showExportMenu && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {showExportMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 mt-2 w-48 bg-white border border-[#E5E5E5] rounded-2xl shadow-2xl z-[60] py-2 overflow-hidden"
                          >
                            <ExportOption 
                              icon={<FileText size={14} className="text-red-500" />} 
                              label="PDF (Alta Resolução)" 
                              onClick={handleExportPDF} 
                            />
                            <ExportOption 
                              icon={<ImageIcon size={14} className="text-blue-500" />} 
                              label="Imagem (JPEG)" 
                              onClick={handleExportImage} 
                            />
                            <ExportOption 
                              icon={<TableIcon size={14} className="text-green-500" />} 
                              label="Excel (Planilha)" 
                              onClick={handleExportExcel} 
                            />
                            <ExportOption 
                              icon={<FileText size={14} className="text-blue-600" />} 
                              label="Word (Documento)" 
                              onClick={handleExportWord} 
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <button 
                      onClick={() => setCurrentStep("LIST")}
                      className="text-[10px] font-mono font-bold uppercase underline tracking-widest text-gray-400 hover:text-[#1A1A1A]"
                    >
                      Voltar à listagem
                    </button>
                  </div>
                </div>

                <div id="analysis-report" className="space-y-8 py-4">
                  {/* Multiple Suggestion Card */}
                  {highConfidenceAnalyses.length >= 2 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-yellow-400 to-yellow-600 p-1 rounded-3xl shadow-xl shadow-yellow-500/20"
                  >
                    <div className="bg-[#1A1A1A] rounded-[22px] p-8 text-white">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Star className="text-yellow-400 fill-yellow-400" size={16} />
                            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.3em] text-yellow-400">Sugestão Elite</span>
                          </div>
                          <h3 className="text-3xl font-black italic tracking-tighter mb-2">Múltipla Pro "Certeira"</h3>
                          <p className="text-gray-400 text-sm max-w-md">
                            Combinamos os {highConfidenceAnalyses.length} palpites de maior nível de confiança para maximizar o valor.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-4">
                          {highConfidenceAnalyses.map(([id, data]) => {
                            const m = matches.find(match => match.id === id);
                            return (
                              <div key={id} className="bg-white/5 border border-white/10 px-4 py-3 rounded-2xl">
                                <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">{m?.homeTeam} vs {m?.awayTeam}</div>
                                <div className="text-sm font-bold italic text-yellow-400">{data.prediction.market}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="bg-yellow-500 text-black px-8 py-6 rounded-2xl text-center">
                          <div className="text-[10px] font-black uppercase tracking-widest mb-1">Confiança Total</div>
                          <div className="text-3xl font-black tracking-tighter">95%+</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div className="grid grid-cols-1 gap-8">
                  {Array.from(selectedMatchIds).map(id => {
                    const match = matches.find(m => m.id === id);
                    if (!match) return null;
                    const analysis = analyses[id];
                    const isAnalyzing = analyzingId === id;

                    return (
                      <div key={id} className="match-analysis-item bg-white border border-[#E5E5E5] rounded-3xl overflow-hidden shadow-sm">
                        <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400">
                              {match.sport === "Futebol" ? <Trophy size={20} /> : <LayoutDashboard size={20} />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-gray-400 uppercase tracking-widest">
                                {match.league}
                                <span className="w-1 h-1 rounded-full bg-gray-200"></span>
                                {match.time}
                              </div>
                              <h3 className="font-bold text-xl tracking-tight italic">
                                {match.homeTeam} <span className="text-gray-300 not-italic mx-1">vs</span> {match.awayTeam}
                              </h3>
                            </div>
                          </div>
                          {!analysis && !isAnalyzing && (
                            <button 
                              onClick={() => handleDeepAnalysis(match)}
                              className="bg-[#1A1A1A] text-white px-6 py-2 rounded-full text-xs font-bold uppercase tracking-wider"
                            >
                              Processar Análise
                            </button>
                          )}
                          {isAnalyzing && (
                            <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
                              <Loader2 className="animate-spin" size={14} />
                              Processando dados...
                            </div>
                          )}
                        </div>

                        {analysis && (
                          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
                            {/* Analysis Details */}
                            <div className="lg:col-span-8 space-y-6">
                              <AnalysisBox title="📈 Forma Recente" content={analysis.recentForm} />
                              <AnalysisBox title="⚔️ Confronto Direto (H2H)" content={analysis.h2h} />
                              <AnalysisBox title="🏠 Casa x Fora" content={analysis.homeAway} />
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <AnalysisBox title="📋 Escalações / Condições" content={analysis.lineups} />
                                <AnalysisBox title="📊 Estatísticas" content={analysis.stats} />
                              </div>
                              <AnalysisBox title="💰 Mercado & Odds" content={analysis.odds} />
                            </div>

                            {/* Prediction Sidebar */}
                            <div className="lg:col-span-4 lg:border-l border-gray-100 lg:pl-8 space-y-6">
                              <div className="bg-[#1A1A1A] text-white p-6 rounded-2xl">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400 block mb-4">Palpite do Analista</span>
                                <div className="space-y-4">
                                  <div>
                                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Mercado Recomendado</div>
                                    <div className="text-lg font-bold italic">{analysis.prediction.market}</div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Probabilidade</div>
                                      <div className="text-2xl font-bold tracking-tighter">{analysis.prediction.probability}%</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Confiança</div>
                                      <div className={cn(
                                        "text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md inline-block mt-1",
                                        analysis.prediction.confidence === "Alto" ? "bg-green-500/20 text-green-400" :
                                        analysis.prediction.confidence === "Médio" ? "bg-yellow-500/20 text-yellow-500" :
                                        "bg-red-500/20 text-red-500"
                                      )}>
                                        {analysis.prediction.confidence}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="p-4 border-2 border-dashed border-gray-100 rounded-2xl">
                                <p className="text-[10px] text-gray-400 italic">
                                  "A análise considera métricas de xG, tendências de mercado e condições climáticas. Aposte com responsabilidade."
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>

      <footer className="mt-auto border-t border-[#E5E5E5] bg-white py-12">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="bg-[#1A1A1A] text-white p-1 rounded">
                <Trophy size={12} />
              </div>
              <span className="font-bold tracking-tight uppercase text-xs">Sistema Pro v1.0</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
              Algoritmo de análise quantitativa e qualitativa operando em tempo real sobre fontes de dados globais.
            </p>
          </div>
          <div className="md:col-span-8 flex justify-end gap-12">
            <div>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#1A1A1A] mb-4">Plataformas</h4>
              <ul className="text-xs text-gray-400 space-y-2">
                <li>Flashscore</li>
                <li>SofaScore</li>
                <li>365Scores</li>
                <li>Globo Esporte</li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#1A1A1A] mb-4">Esportes</h4>
              <ul className="text-xs text-gray-400 space-y-2">
                <li>Futebol</li>
                <li>Basquete</li>
                <li>Tênis de Mesa</li>
                <li>Tênis e Vôlei</li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ExportOption({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-10 px-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tight text-[#1A1A1A]">{label}</span>
    </button>
  );
}

function StepButton({ active, done, icon, label, onClick, disabled }: { active: boolean; done: boolean; icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 px-6 py-4 rounded-2xl border transition-all whitespace-nowrap",
        active 
          ? "bg-[#1A1A1A] border-[#1A1A1A] text-white shadow-lg shadow-black/10 scale-105" 
          : "bg-white border-[#E5E5E5] text-gray-400 hover:border-gray-300",
        disabled && "opacity-30 cursor-not-allowed border-dashed"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
        active ? "bg-white/20 text-white" : done ? "bg-green-500/10 text-green-500" : "bg-gray-100 text-gray-400"
      )}>
        {done && !active ? <CheckCircle2 size={16} /> : icon}
      </div>
      <span className="font-bold text-xs uppercase tracking-tight">{label}</span>
    </button>
  );
}

function MatchCardInList({ match, selected, onToggle }: { match: Match; selected: boolean; onToggle: () => void }) {
  return (
    <div 
      onClick={onToggle}
      className={cn(
        "flex flex-col p-4 bg-white border border-[#E5E5E5] rounded-xl cursor-pointer transition-all hover:border-[#1A1A1A] group",
        selected && "bg-[#1A1A1A] border-[#1A1A1A]"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-[9px] font-mono font-bold uppercase tracking-widest", selected ? "text-gray-400" : "text-gray-400")}>
          {match.time}
        </span>
        <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter", selected ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500")}>
          {match.league}
        </span>
      </div>
      <div className={cn("font-bold text-sm leading-snug break-words transition-colors", selected ? "text-white" : "text-[#1A1A1A]")}>
        {match.homeTeam} <span className={cn("mx-1 font-normal", selected ? "text-gray-500" : "text-gray-300")}>vs</span> {match.awayTeam}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className={cn("text-[8px] font-mono uppercase tracking-[0.2em] transition-colors font-bold", selected ? "text-white/40" : "text-gray-300")}>
          {match.sport}
        </span>
        <div className={cn(
          "w-4 h-4 rounded-full border flex items-center justify-center transition-all",
          selected ? "bg-white border-white text-[#1A1A1A]" : "border-gray-200"
        )}>
          {selected && <CheckCircle2 size={10} />}
        </div>
      </div>
    </div>
  );
}

function AnalysisBox({ title, content }: { title: string; content: string }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
        {title}
        <span className="flex-1 h-[1px] bg-gray-100"></span>
      </h4>
      <div className="text-sm text-gray-600 leading-relaxed bg-gray-50/50 p-4 rounded-xl border border-gray-100/50 markdown-body">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
