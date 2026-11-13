(function () {
  const REGIONS = {
    N:  { name: 'Norte',        hsp: 4.85, tarifa: 0.96 },
    NE: { name: 'Nordeste',     hsp: 5.55, tarifa: 0.90 },
    CO: { name: 'Centro-Oeste', hsp: 5.20, tarifa: 0.88 },
    SE: { name: 'Sudeste',      hsp: 4.95, tarifa: 0.92 },
    S:  { name: 'Sul',          hsp: 4.45, tarifa: 0.84 }
  };

  const UF_TO_REGION = {
    AC: 'N', AP: 'N', AM: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
    AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
    DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO',
    ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
    PR: 'S', RS: 'S', SC: 'S'
  };

  const TAXA_MINIMA_KWH = {
    mono: 30,
    bi: 50,
    tri: 100
  };

  const FATOR_TELHADO = {
    ceramico: 1.00,
    fibrocimento: 1.04,
    laje: 1.12
  };

  let paymentMode = 'avista';
  let lastChartData = null;

  function formatBRL(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function detectRegionFromCepPrefix(cepDigits) {
    if (!cepDigits || cepDigits.length < 1) return null;
    const first = parseInt(cepDigits[0], 10);
    const two = cepDigits.length >= 2 ? parseInt(cepDigits.slice(0, 2), 10) : null;
    if (first >= 0 && first <= 3) return 'SE';
    if (first === 4 || first === 5) return 'NE';
    if (first === 6) {
      if (two !== null && two >= 66) return 'N';
      return 'NE';
    }
    if (first === 7) {
      if (two !== null && (two === 76 || two === 77)) return 'N';
      return 'CO';
    }
    if (first === 8 || first === 9) return 'S';
    return null;
  }

  // Média nacional 2026 (referência Greener / Canal Solar / Portal Solar)
  function getCostPerKwp(kwp) {
    if (kwp <= 2.5) return 5100;
    if (kwp <= 5.0) {
      return 5100 - ((kwp - 2.5) / 2.5) * (5100 - 4100);
    }
    if (kwp <= 9.0) {
      return 4100 - ((kwp - 5.0) / 4.0) * (4100 - 3600);
    }
    return 3450;
  }

  // Tabela Price
  function calcTabelaPrice(principal, monthlyRatePct, months) {
    const i = monthlyRatePct / 100;
    if (i <= 0 || months <= 0) {
      return { pmt: principal / Math.max(1, months), total: principal, interest: 0 };
    }
    const factor = Math.pow(1 + i, months);
    const pmt = principal * ((i * factor) / (factor - 1));
    const total = pmt * months;
    return {
      pmt: pmt,
      total: total,
      interest: Math.max(0, total - principal)
    };
  }

  function syncInputAndRange(numberId, rangeId) {
    const numEl = document.getElementById(numberId);
    const rangeEl = document.getElementById(rangeId);
    if (!numEl || !rangeEl) return;

    numEl.addEventListener('input', function () {
      const val = parseFloat(numEl.value);
      if (!isNaN(val)) {
        rangeEl.value = Math.min(parseFloat(rangeEl.max), Math.max(parseFloat(rangeEl.min), val));
      }
      calcularSimulacao();
    });

    rangeEl.addEventListener('input', function () {
      numEl.value = rangeEl.value;
      calcularSimulacao();
    });
  }

  function setupPaymentToggle() {
    const btnAvista = document.getElementById('btn-pag-avista');
    const btnParcelado = document.getElementById('btn-pag-parcelado');
    const finOptions = document.getElementById('financing-options');
    if (!btnAvista || !btnParcelado || !finOptions) return;

    function setMode(mode) {
      paymentMode = mode;
      btnAvista.classList.toggle('active', mode === 'avista');
      btnParcelado.classList.toggle('active', mode === 'parcelado');
      finOptions.style.display = mode === 'parcelado' ? 'block' : 'none';
      calcularSimulacao();
    }

    btnAvista.addEventListener('click', function () { setMode('avista'); });
    btnParcelado.addEventListener('click', function () { setMode('parcelado'); });
  }

  function setupCepLookup() {
    const cepInput = document.getElementById('cep');
    const regiaoSelect = document.getElementById('regiao');
    const statusEl = document.getElementById('cep-status');
    if (!cepInput || !regiaoSelect || !statusEl) return;

    let lastQueried = '';

    cepInput.addEventListener('input', function () {
      let digits = cepInput.value.replace(/\D/g, '').slice(0, 8);
      if (digits.length > 5) {
        cepInput.value = digits.slice(0, 5) + '-' + digits.slice(5);
      } else {
        cepInput.value = digits;
      }

      if (digits.length === 8 && digits !== lastQueried) {
        lastQueried = digits;
        const fallbackReg = detectRegionFromCepPrefix(digits);
        if (fallbackReg) {
          regiaoSelect.value = fallbackReg;
          calcularSimulacao();
        }

        statusEl.textContent = 'Buscando localização...';
        statusEl.className = 'cep-status';

        fetch('https://viacep.com.br/ws/' + digits + '/json/')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && !data.erro && data.uf) {
              const reg = UF_TO_REGION[data.uf] || fallbackReg || 'SE';
              regiaoSelect.value = reg;
              statusEl.textContent = data.localidade + ' - ' + data.uf + ' (' + REGIONS[reg].name + ')';
              statusEl.className = 'cep-status ok';
              calcularSimulacao();
            } else {
              statusEl.textContent = 'CEP não encontrado. Usando região selecionada.';
              statusEl.className = 'cep-status err';
            }
          })
          .catch(function () {
            if (fallbackReg) {
              statusEl.textContent = 'Região estimada pelo CEP: ' + REGIONS[fallbackReg].name;
              statusEl.className = 'cep-status ok';
            } else {
              statusEl.textContent = '';
            }
          });
      } else if (digits.length < 8) {
        statusEl.textContent = '';
      }
    });
  }

  function drawChart(data, hoverYear) {
    const canvas = document.getElementById('payback-chart');
    if (!canvas) return;
    lastChartData = data;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(280, rect.width);
    const height = 250;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)';
    const noSolarColor = isDark ? '#94a3b8' : '#475569';
    const solarColor = '#10b981';
    const financedColor = '#d97706';

    const pad = { top: 20, right: 20, bottom: 32, left: 66 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const maxFin = data.isFinanced ? data.comSolarFin[data.comSolarFin.length - 1] : 0;
    const maxVal = Math.max(
      data.semSolar[data.semSolar.length - 1],
      data.comSolar[data.comSolar.length - 1],
      maxFin,
      1000
    ) * 1.08;

    function xPos(yearIdx) {
      return pad.left + (yearIdx / (data.semSolar.length - 1)) * plotW;
    }

    function yPos(val) {
      return pad.top + plotH - (val / maxVal) * plotH;
    }

    // Horizontal grid & Y labels
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = textColor;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const val = (maxVal / ticks) * i;
      const y = yPos(val);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      const label = 'R$ ' + Math.round(val / 1000) + 'k';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pad.left - 8, y);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    [0, 5, 10, 15].forEach(function (yr) {
      if (yr < data.semSolar.length) {
        ctx.fillText('Ano ' + yr, xPos(yr), height - pad.bottom + 8);
      }
    });

    // Area fill under "Com Solar À Vista"
    ctx.beginPath();
    data.comSolar.forEach(function (val, idx) {
      const x = xPos(idx);
      const y = yPos(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xPos(data.comSolar.length - 1), yPos(0));
    ctx.lineTo(xPos(0), yPos(0));
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.09)' : 'rgba(16, 185, 129, 0.08)';
    ctx.fill();

    // Line: Sem Solar
    ctx.beginPath();
    ctx.strokeStyle = noSolarColor;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    data.semSolar.forEach(function (val, idx) {
      const x = xPos(idx);
      const y = yPos(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Line: Com Solar À Vista
    ctx.beginPath();
    ctx.strokeStyle = solarColor;
    ctx.lineWidth = 3;
    data.comSolar.forEach(function (val, idx) {
      const x = xPos(idx);
      const y = yPos(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Line: Com Solar Parcelado (if active)
    if (data.isFinanced) {
      ctx.beginPath();
      ctx.strokeStyle = financedColor;
      ctx.lineWidth = 2.5;
      data.comSolarFin.forEach(function (val, idx) {
        const x = xPos(idx);
        const y = yPos(val);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Payback marker
    const activePayback = data.isFinanced ? data.paybackFinYears : data.paybackYears;
    const activeSeries = data.isFinanced ? data.comSolarFin : data.comSolar;
    if (activePayback > 0 && activePayback <= 15) {
      const px = xPos(activePayback);
      const idxFloor = Math.floor(activePayback);
      const frac = activePayback - idxFloor;
      const valAtPayback =
        activeSeries[idxFloor] +
        ((activeSeries[Math.min(15, idxFloor + 1)] - activeSeries[idxFloor]) * frac);
      const py = yPos(valAtPayback);

      ctx.beginPath();
      ctx.fillStyle = data.isFinanced ? financedColor : '#059669';
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isDark ? '#fcd34d' : '#92400e';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = px > width * 0.72 ? 'right' : 'left';
      ctx.fillText('Payback', px + (px > width * 0.72 ? -8 : 8), py - 10);
    }

    // Hover indicator line & dots
    if (typeof hoverYear === 'number' && hoverYear >= 0 && hoverYear < data.semSolar.length) {
      const hx = xPos(hoverYear);
      ctx.beginPath();
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.18)';
      ctx.lineWidth = 1;
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();

      [
        { val: data.semSolar[hoverYear], color: noSolarColor },
        { val: data.comSolar[hoverYear], color: solarColor },
        ...(data.isFinanced ? [{ val: data.comSolarFin[hoverYear], color: financedColor }] : [])
      ].forEach(function (pt) {
        ctx.beginPath();
        ctx.fillStyle = pt.color;
        ctx.arc(hx, yPos(pt.val), 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function setupChartHover() {
    const canvas = document.getElementById('payback-chart');
    const tooltip = document.getElementById('chart-tooltip');
    if (!canvas || !tooltip) return;

    function handleMove(clientX) {
      if (!lastChartData) return;
      const rect = canvas.getBoundingClientRect();
      const padLeft = 66;
      const padRight = 20;
      const plotW = rect.width - padLeft - padRight;
      const relX = clientX - rect.left - padLeft;
      const ratio = Math.max(0, Math.min(1, relX / plotW));
      const yr = Math.round(ratio * (lastChartData.semSolar.length - 1));

      drawChart(lastChartData, yr);

      let html = '<strong>Ano ' + yr + '</strong><br>' +
        'Sem Solar: ' + formatBRL(lastChartData.semSolar[yr]) + '<br>' +
        '<span style="color:#10b981;">À Vista: ' + formatBRL(lastChartData.comSolar[yr]) + '</span>';
      if (lastChartData.isFinanced) {
        html += '<br><span style="color:#d97706;">Parcelado: ' + formatBRL(lastChartData.comSolarFin[yr]) + '</span>';
      }
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      const tipX = Math.min(rect.width - 185, Math.max(8, (clientX - rect.left) + 12));
      tooltip.style.left = tipX + 'px';
      tooltip.style.top = '12px';
    }

    canvas.addEventListener('mousemove', function (e) { handleMove(e.clientX); });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener('mouseleave', function () {
      tooltip.style.display = 'none';
      if (lastChartData) drawChart(lastChartData);
    });
  }

  window.redrawSolarChart = function () {
    if (lastChartData) {
      drawChart(lastChartData);
    }
  };

  window.calcularSimulacao = function () {
    const gastoNormal = Math.max(0, parseFloat(document.getElementById('gasto-normal').value) || 0);
    const gastoVerao = Math.max(0, parseFloat(document.getElementById('gasto-verao').value) || 0);
    const mesesVerao = parseInt(document.getElementById('meses-verao').value, 10) || 4;
    const regiaoKey = document.getElementById('regiao').value || 'SE';
    const padraoKey = document.getElementById('padrao').value || 'bi';
    const telhadoKey = document.getElementById('telhado').value || 'ceramico';

    const parcelas = parseInt(document.getElementById('parcelas').value, 10) || 48;
    const jurosMensal = Math.max(0, parseFloat(document.getElementById('juros-mensal').value) || 1.65);

    const regiao = REGIONS[regiaoKey] || REGIONS.SE;
    const taxaMinimaKwh = TAXA_MINIMA_KWH[padraoKey] || 50;
    const fatorTelhado = FATOR_TELHADO[telhadoKey] || 1.0;

    // 1. Média ponderada real (normal + verão)
    const mesesNormais = 12 - mesesVerao;
    const gastoMedioMensal = (gastoNormal * mesesNormais + gastoVerao * mesesVerao) / 12;
    const gastoAnualSemSolar = gastoMedioMensal * 12;

    const aumentoVeraoPct = gastoNormal > 0
      ? Math.round(((gastoVerao - gastoNormal) / gastoNormal) * 100)
      : 0;

    // 2. Consumo em kWh (descontando CIP média ~R$ 25)
    const cipMedia = 25;
    const consumoMedioKwh = Math.max(0, (gastoMedioMensal - cipMedia) / regiao.tarifa);
    const consumoVeraoKwh = Math.max(0, (gastoVerao - cipMedia) / regiao.tarifa);

    // 3. Dimensionamento (painéis de 550W, PR 0.78)
    const geracaoPorKwpMes = regiao.hsp * 30.4 * 0.78;
    const kwpBruto = consumoMedioKwh / geracaoPorKwpMes;
    const numPaineis = Math.max(3, Math.round(kwpBruto / 0.55));
    const kwpFinal = numPaineis * 0.55;
    const areaTelhado = numPaineis * 2.6;

    // 4. Custos reais 2026 (Equipamentos + Instalação/Homologação)
    const custoKwp = getCostPerKwp(kwpFinal);
    const investimentoAVista = kwpFinal * custoKwp * fatorTelhado;
    const custoEquipamentos = investimentoAVista * 0.64;
    const custoInstalacao = investimentoAVista * 0.36;
    const investMin = investimentoAVista * 0.90;
    const investMax = investimentoAVista * 1.12;

    // Financiamento (Tabela Price)
    const fin = calcTabelaPrice(investimentoAVista, jurosMensal, parcelas);
    const isFinanced = paymentMode === 'parcelado';

    // 5. Lei 14.300 (Fio B a 60% em 2026) + Taxa Mínima
    const custoDisponibilidade = taxaMinimaKwh * regiao.tarifa;
    const custoFioBMensal = (consumoMedioKwh * 0.68) * (regiao.tarifa * 0.28 * 0.60);
    const novaContaMedia = Math.min(
      gastoMedioMensal,
      Math.max(custoDisponibilidade, custoFioBMensal) + cipMedia
    );

    const novaContaNormal = Math.min(
      gastoNormal,
      Math.max(custoDisponibilidade, (Math.max(0, (gastoNormal - cipMedia) / regiao.tarifa) * 0.68) * (regiao.tarifa * 0.28 * 0.60)) + cipMedia
    );
    const novaContaVerao = Math.min(
      gastoVerao,
      Math.max(custoDisponibilidade, (consumoVeraoKwh * 0.68) * (regiao.tarifa * 0.28 * 0.60)) + cipMedia
    );

    const economiaMensalMedia = Math.max(0, gastoMedioMensal - novaContaMedia);

    // 6. Projeção de 25 anos (reajuste tarifário 6% a.a., degradação 0.5% a.a.)
    const semSolar15 = [0];
    const comSolar15 = [investimentoAVista];
    const comSolarFin15 = [0]; // Parcelado começa sem desembolso inicial à vista, paga parcelas ao longo dos meses

    let acumSem = 0;
    let acumCom = investimentoAVista;
    let acumComFin = 0;

    let paybackYears = 0;
    let paybackFound = false;
    let paybackFinYears = 0;
    let paybackFinFound = false;

    let economia15Anos = 0;
    let economia25Anos = 0;
    let economia15AnosFin = 0;
    let economia25AnosFin = 0;

    const anosFinanciamento = parcelas / 12;

    for (let yr = 1; yr <= 25; yr++) {
      const fatorInflacao = Math.pow(1.06, yr - 1);
      const fatorDegradacao = Math.pow(0.995, yr - 1);
      const gastoAnoSem = gastoAnualSemSolar * fatorInflacao;
      const economiaAno = (economiaMensalMedia * 12) * fatorInflacao * fatorDegradacao;
      const gastoAnoCom = Math.max(0, gastoAnoSem - economiaAno);

      // Parcela paga neste ano
      let parcelaAno = 0;
      if (yr <= Math.floor(anosFinanciamento)) {
        parcelaAno = fin.pmt * 12;
      } else if (yr - 1 < anosFinanciamento) {
        parcelaAno = fin.pmt * ((anosFinanciamento - (yr - 1)) * 12);
      }

      const prevDiff = acumSem - acumCom;
      const prevDiffFin = acumSem - acumComFin;

      acumSem += gastoAnoSem;
      acumCom += gastoAnoCom;
      acumComFin += gastoAnoCom + parcelaAno;

      const newDiff = acumSem - acumCom;
      const newDiffFin = acumSem - acumComFin;

      if (!paybackFound && newDiff >= 0) {
        const stepGain = newDiff - prevDiff;
        const frac = stepGain > 0 ? Math.abs(prevDiff) / stepGain : 0;
        paybackYears = (yr - 1) + frac;
        paybackFound = true;
      }

      if (!paybackFinFound && yr >= Math.ceil(anosFinanciamento) && newDiffFin >= 0) {
        const stepGainFin = newDiffFin - prevDiffFin;
        const fracFin = stepGainFin > 0 ? Math.abs(prevDiffFin) / stepGainFin : 0;
        paybackFinYears = (yr - 1) + fracFin;
        paybackFinFound = true;
      }

      if (yr <= 15) {
        semSolar15.push(acumSem);
        comSolar15.push(acumCom);
        comSolarFin15.push(acumComFin);
      }
      if (yr === 15) {
        economia15Anos = acumSem - acumCom;
        economia15AnosFin = acumSem - acumComFin;
      }
      if (yr === 25) {
        economia25Anos = acumSem - acumCom;
        economia25AnosFin = acumSem - acumComFin;
      }
    }

    if (!paybackFound) {
      paybackYears = economiaMensalMedia > 0 ? investimentoAVista / (economiaMensalMedia * 12) : 99;
    }
    if (!paybackFinFound) {
      paybackFinYears = economiaMensalMedia > 0 ? fin.total / (economiaMensalMedia * 12) : 99;
    }

    const activePayback = isFinanced ? paybackFinYears : paybackYears;
    const activeLucro15 = isFinanced ? economia15AnosFin : economia15Anos;
    const activeLucro25 = isFinanced ? economia25AnosFin : economia25Anos;

    // 7. Atualizar UI
    const banner = document.getElementById('viability-banner');
    const vTag = document.getElementById('viability-tag');
    const vTitle = document.getElementById('viability-title');
    const vDesc = document.getElementById('viability-desc');

    if (gastoMedioMensal < 170 || economiaMensalMedia < 80 || activePayback > 8.5) {
      banner.className = 'viability-banner low';
      vTag.textContent = 'Baixa Viabilidade';
      vTitle.textContent = 'Retorno lento para o seu consumo atual';
      vDesc.textContent =
        'Considerando os custos reais de instalação' + (isFinanced ? ' e os juros do parcelamento' : '') +
        ', o sistema demoraria cerca de ' + formatPayback(activePayback) +
        ' para se pagar porque sua conta é próxima da taxa mínima. Avalie energia por assinatura ou aguarde caso seu consumo aumente.';
    } else if (activePayback <= 5.5 && gastoMedioMensal >= 280) {
      banner.className = 'viability-banner high';
      vTag.textContent = 'Alta Viabilidade';
      vTitle.textContent = isFinanced
        ? 'Vale a pena mesmo parcelado!'
        : 'Vale muito a pena instalar energia solar!';
      vDesc.textContent =
        'Com sua média anual de ' + formatBRL(gastoMedioMensal) +
        '/mês (incluindo o verão), o sistema se paga em cerca de ' +
        formatPayback(activePayback) +
        (isFinanced ? ' (já descontando os juros de ' + formatBRL(fin.interest) + ' do financiamento).' : ' e gera lucro líquido por mais de 20 anos.');
    } else {
      banner.className = 'viability-banner medium';
      vTag.textContent = 'Viabilidade Moderada';
      vTitle.textContent = 'Vale a pena no médio e longo prazo';
      vDesc.textContent =
        'O retorno estimado é de ' + formatPayback(activePayback) +
        (isFinanced ? ' com parcelamento em ' + parcelas + 'x.' : '.') +
        ' Os reajustes anuais da tarifa e os picos de verão tornam o investimento positivo ao longo da vida útil.';
    }

    document.getElementById('res-investimento').textContent = isFinanced
      ? formatBRL(fin.total)
      : formatBRL(investimentoAVista);
    document.getElementById('res-invest-faixa').textContent = isFinanced
      ? 'À vista: ' + formatBRL(investimentoAVista) + ' (+ ' + formatBRL(fin.interest) + ' de juros)'
      : 'Faixa de mercado: ' + formatBRL(investMin) + ' a ' + formatBRL(investMax);

    document.getElementById('res-payback').textContent = activePayback > 25 ? '+25 anos' : formatPayback(activePayback);
    document.getElementById('res-economia-mes').textContent = formatBRL(economiaMensalMedia) + '/mês';
    document.getElementById('res-nova-conta').textContent =
      'Nova conta média estimada: ' + formatBRL(novaContaMedia) + '/mês';

    document.getElementById('res-lucro-25').textContent = formatBRL(Math.max(0, activeLucro25));
    document.getElementById('res-lucro-15').textContent =
      'Em 15 anos: ' + formatBRL(Math.max(0, activeLucro15));

    // Card de Parcelamento
    const finCard = document.getElementById('financing-card');
    const legendParcelado = document.getElementById('legend-parcelado');
    if (isFinanced) {
      finCard.style.display = 'block';
      if (legendParcelado) legendParcelado.style.display = 'inline-flex';
      document.getElementById('fin-badge-prazo').textContent = parcelas + 'x de ' + formatBRL(fin.pmt);
      document.getElementById('fin-parcela').textContent = formatBRL(fin.pmt) + '/mês';
      document.getElementById('fin-total-pago').textContent = formatBRL(fin.total);
      document.getElementById('fin-total-juros').textContent = '+ ' + formatBRL(fin.interest);

      const diferencaMensal = fin.pmt - economiaMensalMedia;
      const fluxoEl = document.getElementById('fin-fluxo-mensal');
      if (diferencaMensal <= 0) {
        fluxoEl.textContent = 'Sobra ' + formatBRL(Math.abs(diferencaMensal)) + '/mês';
        fluxoEl.style.color = 'var(--primary)';
      } else {
        fluxoEl.textContent = 'Completa ' + formatBRL(diferencaMensal) + '/mês';
        fluxoEl.style.color = 'var(--solar-text)';
      }
    } else {
      finCard.style.display = 'none';
      if (legendParcelado) legendParcelado.style.display = 'none';
    }

    // Detalhes Técnicos & Custos
    document.getElementById('det-media-real').textContent = formatBRL(gastoMedioMensal) + '/mês';
    document.getElementById('det-consumo-kwh').textContent = Math.round(consumoMedioKwh) + ' kWh/mês';
    document.getElementById('det-potencia').textContent =
      kwpFinal.toFixed(2).replace('.', ',') + ' kWp (' + numPaineis + ' placas de 550W)';
    document.getElementById('det-area').textContent = areaTelhado.toFixed(0) + ' m² de telhado';
    document.getElementById('det-equipamentos').textContent = formatBRL(custoEquipamentos);
    document.getElementById('det-instalacao').textContent = formatBRL(custoInstalacao);

    // Barras Comparativas (Normal vs Verão)
    const maxBar = Math.max(gastoVerao, gastoNormal, 100);
    document.getElementById('lbl-normal-antes').textContent = formatBRL(gastoNormal);
    document.getElementById('lbl-normal-depois').textContent = formatBRL(novaContaNormal);
    document.getElementById('bar-normal-antes').style.width = Math.min(100, (gastoNormal / maxBar) * 100) + '%';
    document.getElementById('bar-normal-depois').style.width = Math.min(100, (novaContaNormal / maxBar) * 100) + '%';

    document.getElementById('lbl-verao-antes').textContent =
      formatBRL(gastoVerao) + (aumentoVeraoPct > 0 ? ' (+' + aumentoVeraoPct + '%)' : '');
    document.getElementById('lbl-verao-depois').textContent = formatBRL(novaContaVerao);
    document.getElementById('bar-verao-antes').style.width = Math.min(100, (gastoVerao / maxBar) * 100) + '%';
    document.getElementById('bar-verao-depois').style.width = Math.min(100, (novaContaVerao / maxBar) * 100) + '%';

    drawChart({
      semSolar: semSolar15,
      comSolar: comSolar15,
      comSolarFin: comSolarFin15,
      paybackYears: paybackYears,
      paybackFinYears: paybackFinYears,
      isFinanced: isFinanced
    });
  };

  function formatPayback(years) {
    if (years >= 25) return '+25 anos';
    const wholeYears = Math.floor(years);
    const months = Math.round((years - wholeYears) * 12);
    if (months === 12) {
      return (wholeYears + 1) + (wholeYears + 1 === 1 ? ' ano' : ' anos');
    }
    if (wholeYears === 0) {
      return months + (months === 1 ? ' mês' : ' meses');
    }
    if (months === 0) {
      return wholeYears + (wholeYears === 1 ? ' ano' : ' anos');
    }
    return wholeYears + (wholeYears === 1 ? ' ano e ' : ' anos e ') + months + (months === 1 ? ' mês' : ' meses');
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncInputAndRange('gasto-normal', 'range-normal');
    syncInputAndRange('gasto-verao', 'range-verao');
    setupPaymentToggle();
    setupCepLookup();
    setupChartHover();

    ['meses-verao', 'regiao', 'padrao', 'telhado', 'parcelas', 'juros-mensal'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', calcularSimulacao);
        el.addEventListener('input', calcularSimulacao);
      }
    });

    const form = document.getElementById('simulador-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        calcularSimulacao();
        const resEl = document.getElementById('resultado-painel');
        if (resEl && window.innerWidth <= 960) {
          resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    window.addEventListener('resize', function () {
      if (lastChartData) drawChart(lastChartData);
    });

    calcularSimulacao();
  });
})();
