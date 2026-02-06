const express = require('express');
const auth = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { stringify } = require('csv-stringify/sync');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const User = require('../models/User');
const Account = require('../models/Account');
const BillReminder = require('../models/BillReminder');

const router = express.Router();

// Helper: Format currency
const formatCurrency = (amount) => `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Helper: Get month name
const getMonthName = (month) => {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month - 1];
};

// Helper: Get date as YYYY-MM-DD
const formatDate = (date) => {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

// ============================================
// REPORT DATA GENERATORS
// ============================================

const getMonthlyReportData = async (userId, month, year) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // Last day of month

  const transactions = await Transaction.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: -1 });

  const groupedByCategory = {};
  const groupedByDay = {};
  let totalIncome = 0;
  let totalExpense = 0;

  transactions.forEach((tx) => {
    // Use regex matching like analytics/stats endpoint does
    const isIncome = /income/i.test(tx.type);
    const isExpense = /expense/i.test(tx.type);
    const amount = tx.amount;
    const day = String(tx.date.getDate()).padStart(2, '0');

    if (isIncome) {
      totalIncome += amount;
    } else if (isExpense) {
      totalExpense += amount;
      if (!groupedByCategory[tx.category]) {
        groupedByCategory[tx.category] = 0;
      }
      groupedByCategory[tx.category] += amount;
    }

    // Group by day for daily expense analysis
    if (!groupedByDay[day]) {
      groupedByDay[day] = { income: 0, expense: 0 };
    }
    if (isIncome) {
      groupedByDay[day].income += amount;
    } else if (isExpense) {
      groupedByDay[day].expense += amount;
    }
  });

  const savings = totalIncome - totalExpense;
  const sortedCategories = Object.entries(groupedByCategory)
    .sort((a, b) => b[1] - a[1]);

  return {
    period: `${getMonthName(month)} ${year}`,
    month,
    year,
    totalIncome,
    totalExpense,
    savings,
    categories: Object.fromEntries(sortedCategories),
    highestCategory: sortedCategories.length > 0 ? sortedCategories[0][0] : 'N/A',
    highestAmount: sortedCategories.length > 0 ? sortedCategories[0][1] : 0,
    transactionCount: transactions.length,
    groupedByDay,
    transactions
  };
};

const getDateRangeReportData = async (userId, fromDate, toDate) => {
  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  const transactions = await Transaction.find({
    userId,
    date: { $gte: start, $lte: end }
  }).sort({ date: -1 });

  let totalIncome = 0;
  let totalExpense = 0;

  transactions.forEach((tx) => {
    // Use regex matching like analytics/stats endpoint does
    if (/income/i.test(tx.type)) {
      totalIncome += tx.amount;
    } else if (/expense/i.test(tx.type)) {
      totalExpense += tx.amount;
    }
  });

  const savings = totalIncome - totalExpense;

  return {
    period: `${formatDate(start)} to ${formatDate(end)}`,
    fromDate: formatDate(start),
    toDate: formatDate(end),
    totalIncome,
    totalExpense,
    savings,
    transactionCount: transactions.length,
    transactions
  };
};

const getBudgetReportData = async (userId, month, year) => {
  const budget = await Budget.findOne({ userId, month, year });
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const allTransactions = await Transaction.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  });

  // Use regex matching like analytics/stats endpoint does
  const expenses = allTransactions.filter(t => /expense/i.test(t.type));
  const incomes = allTransactions.filter(t => /income/i.test(t.type));

  const totalIncome = incomes.reduce((sum, tx) => sum + tx.amount, 0);
  const totalSpent = expenses.reduce((sum, tx) => sum + tx.amount, 0);
  const budgetAmount = budget?.amount || 0;
  const remainingAmount = budgetAmount - totalSpent;
  const isExceeded = totalSpent > budgetAmount;

  // Group expenses by category
  const expensesByCategory = {};
  expenses.forEach(tx => {
    if (!expensesByCategory[tx.category]) {
      expensesByCategory[tx.category] = 0;
    }
    expensesByCategory[tx.category] += tx.amount;
  });

  const sortedExpenses = Object.entries(expensesByCategory)
    .sort((a, b) => b[1] - a[1]);

  return {
    period: `${getMonthName(month)} ${year}`,
    month,
    year,
    totalIncome,
    totalExpense: totalSpent,
    savings: totalIncome - totalSpent,
    monthlyBudget: budgetAmount,
    totalSpent,
    remainingAmount,
    exceeded: isExceeded,
    percentageUsed: budgetAmount > 0 ? ((totalSpent / budgetAmount) * 100).toFixed(2) : 0,
    expenseCount: expenses.length,
    expensesByCategory: Object.fromEntries(sortedExpenses),
    expenses,
    incomes,
    allTransactions
  };
};

const getFullAccountReportData = async (userId, fromDate = null, toDate = null) => {
  const user = await User.findById(userId);
  const accounts = await Account.find({ userId });
  const reminders = await BillReminder.find({ userId });
  const budgets = await Budget.find({ userId });

  let matchCondition = { userId };
  if (fromDate || toDate) {
    matchCondition.date = {};
    if (fromDate) {
      const start = new Date(fromDate);
      start.setHours(0, 0, 0, 0);
      matchCondition.date.$gte = start;
    }
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      matchCondition.date.$lte = end;
    }
  }

  const transactions = await Transaction.find(matchCondition).sort({ date: -1 });

  let totalIncome = 0;
  let totalExpense = 0;
  const categoryWiseSummary = {};

  transactions.forEach((tx) => {
    // Use regex matching like analytics/stats endpoint does
    if (/income/i.test(tx.type)) {
      totalIncome += tx.amount;
    } else if (/expense/i.test(tx.type)) {
      totalExpense += tx.amount;
      if (!categoryWiseSummary[tx.category]) {
        categoryWiseSummary[tx.category] = 0;
      }
      categoryWiseSummary[tx.category] += tx.amount;
    }
  });

  const sortedCategories = Object.entries(categoryWiseSummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const totalAccountBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
  
  // Budget summary
  let totalBudgetAllotted = 0;
  let totalBudgetSpent = 0;
  budgets.forEach(budget => {
    totalBudgetAllotted += budget.amount || 0;
  });

  return {
    userName: user?.username || 'N/A',
    accountCount: accounts.length,
    totalAccountBalance,
    totalIncome,
    totalExpense,
    netBalance: totalIncome - totalExpense,
    transactionCount: transactions.length,
    reminderCount: reminders.length,
    budgetCount: budgets.length,
    totalBudgetAllotted,
    accounts,
    transactions,
    reminders,
    budgets,
    categoryWiseSummary: Object.fromEntries(sortedCategories),
    generatedAt: new Date().toISOString()
  };
};

// ============================================
// FORMAT GENERATORS
// ============================================

const generatePDF = (reportType, reportData, res, fileName) => {
  const pdf = new PDFDocument({ 
    margin: 0,
    bufferPages: true,
    font: 'Helvetica'
  });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  pdf.pipe(res);

  const pageWidth = pdf.page.width;
  const pageHeight = pdf.page.height;
  const colors = {
    navy: '#1e3a8a',
    orange: '#f97316',
    green: '#16a34a',
    red: '#dc2626',
    blue: '#1e3a8a',
    darkGray: '#1f2937',
    gray: '#6b7280',
    lightGray: '#f3f4f6',
    white: '#ffffff',
    border: '#d1d5db'
  };

  // Helper function to add a new page with header and footer
  const addNewPage = () => {
    pdf.addPage();
    drawHeader();
    pdf.moveDown(2);
  };

  // ==== HEADER BAR ====
  const drawHeader = () => {
    // Blue section (left half)
    pdf.rect(0, 0, pageWidth / 2, 60).fill(colors.navy);
    pdf.fontSize(18).fillColor(colors.white).font('Helvetica-Bold');
    pdf.text('MONEY MANAGER REPORT', 20, 18, { width: pageWidth / 2 - 40 });

    // Orange section (right half)
    pdf.rect(pageWidth / 2, 0, pageWidth / 2, 60).fill(colors.orange);
    
    // Bottom border
    pdf.rect(0, 60, pageWidth, 1).fill(colors.gray);
    
    pdf.fontSize(12).fillColor(colors.darkGray);
  };

  // ==== TITLE AND SUBTITLE ====
  const drawTitleSection = () => {
    pdf.moveDown(3);
    
    // Main title - centered
    pdf.fontSize(32).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text(reportType === 'monthly' ? 'Monthly Financial Report' : 
             reportType === 'dateRange' ? 'Transaction Report' :
             reportType === 'budget' ? 'Budget Analysis Report' : 'Account Report',
      0, pdf.y, { align: 'center', width: pageWidth });
    
    pdf.moveDown(0.5);
    
    // Subtitle - centered
    pdf.fontSize(14).fillColor(colors.gray).font('Helvetica');
    pdf.text(reportData.period, 0, pdf.y, { align: 'center', width: pageWidth });
    
    pdf.moveDown(2);
    
    // Separator line
    pdf.rect(50, pdf.y, pageWidth - 100, 1).fill(colors.border);
    
    pdf.moveDown(2);
  };

  // ==== SUMMARY CARDS (4 in one row) ====
  const drawSummaryCards = (cards) => {
    const cardWidth = (pageWidth - 80) / 4;
    const cardHeight = 80;
    let xPos = 40;
    const startY = pdf.y;

    cards.forEach((card, idx) => {
      const cardX = xPos + (idx * cardWidth) + (idx * 10);
      const cardY = startY;

      // Card background
      pdf.rect(cardX, cardY, cardWidth, cardHeight).fill(card.bgColor);

      // Card border
      pdf.rect(cardX, cardY, cardWidth, cardHeight)
        .strokeColor(card.borderColor)
        .lineWidth(2)
        .stroke();

      // Label
      pdf.fillColor(colors.white).fontSize(11).font('Helvetica-Bold');
      pdf.text(card.label, cardX + 10, cardY + 12, { width: cardWidth - 20 });

      // Amount - Large text
      pdf.fontSize(18).fillColor(colors.white).font('Helvetica-Bold');
      pdf.text(card.amount, cardX + 10, cardY + 30, { width: cardWidth - 20 });

      // Subtext if needed
      if (card.subtext) {
        pdf.fontSize(8).fillColor(colors.white).font('Helvetica');
        pdf.text(card.subtext, cardX + 10, cardY + 55, { width: cardWidth - 20 });
      }
    });

    pdf.moveDown(6);
  };

  // ==== TABLE ====
  const drawTable = (headers, rows, colWidthRatios = null) => {
    const margin = 40;
    const tableWidth = pageWidth - (2 * margin);
    
    // Default column widths if not provided
    if (!colWidthRatios) {
      colWidthRatios = headers.map(() => 1 / headers.length);
    }
    
    const colWidths = colWidthRatios.map(ratio => tableWidth * ratio);
    const headerHeight = 30;
    const rowHeight = 25;

    let currentY = pdf.y;

    // Header row
    pdf.rect(margin, currentY, tableWidth, headerHeight).fill(colors.navy);

    pdf.fillColor(colors.white).fontSize(10).font('Helvetica-Bold');
    let colX = margin + 10;
    headers.forEach((header, idx) => {
      pdf.text(header, colX, currentY + 8, { width: colWidths[idx] - 15, align: 'left' });
      colX += colWidths[idx];
    });

    currentY += headerHeight;

    // Data rows
    let alternateColor = false;
    rows.forEach((row, rowIdx) => {
      // Check if we need a new page
      if (currentY + rowHeight > pageHeight - 50) {
        addNewPage();
        currentY = pdf.y + 20;
        
        // Redraw header on new page
        pdf.rect(margin, currentY, tableWidth, headerHeight).fill(colors.navy);
        pdf.fillColor(colors.white).fontSize(10).font('Helvetica-Bold');
        colX = margin + 10;
        headers.forEach((header, idx) => {
          pdf.text(header, colX, currentY + 8, { width: colWidths[idx] - 15, align: 'left' });
          colX += colWidths[idx];
        });
        currentY += headerHeight;
        alternateColor = false;
      }

      // Row background
      if (alternateColor) {
        pdf.rect(margin, currentY, tableWidth, rowHeight).fill(colors.lightGray);
      } else {
        pdf.rect(margin, currentY, tableWidth, rowHeight).fill(colors.white);
      }

      // Row border
      pdf.rect(margin, currentY, tableWidth, rowHeight)
        .strokeColor(colors.border)
        .lineWidth(0.5)
        .stroke();

      // Cell text
      pdf.fillColor(colors.darkGray).fontSize(9).font('Helvetica');
      colX = margin + 10;
      row.forEach((cell, idx) => {
        const text = String(cell).substring(0, 40);
        pdf.text(text, colX, currentY + 7, { width: colWidths[idx] - 15, align: 'left' });
        colX += colWidths[idx];
      });

      currentY += rowHeight;
      alternateColor = !alternateColor;
    });

    pdf.y = currentY;
    pdf.moveDown(1);
  };

  // ==== FOOTER ====
  const drawFooter = () => {
    const footerY = pageHeight - 30;
    
    // Separator line
    pdf.rect(40, footerY - 10, pageWidth - 80, 0.5).fill(colors.border);

    // Generated date - Left
    pdf.fontSize(9).fillColor(colors.gray).font('Helvetica');
    const generatedDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    pdf.text(`Generated on: ${generatedDate}`, 40, footerY + 5);

    // Page info - Right
    const pageCount = pdf.bufferedPageRange().count;
    const pageNumber = pdf.bufferedPageRange().count;
    pdf.text(`Money Manager - Page ${pageNumber}`, 40, footerY + 5, { 
      align: 'right', 
      width: pageWidth - 80 
    });
  };

  // ======== MONTHLY REPORT ========
  if (reportType === 'monthly') {
    drawHeader();
    drawTitleSection();

    // Summary cards - ONLY 4 key metrics
    const cards = [
      {
        label: 'Monthly Income:',
        amount: formatCurrency(reportData.totalIncome),
        bgColor: colors.green,
        borderColor: colors.green,
        color: colors.white
      },
      {
        label: 'Monthly Expense:',
        amount: formatCurrency(reportData.totalExpense),
        bgColor: colors.red,
        borderColor: colors.red,
        color: colors.white
      },
      {
        label: 'Savings:',
        amount: formatCurrency(reportData.savings),
        bgColor: colors.blue,
        borderColor: colors.blue,
        color: colors.white,
        subtext: reportData.savings >= 0 ? 'Positive' : 'Deficit'
      },
      {
        label: 'Savings Ratio:',
        amount: reportData.totalIncome > 0 ? ((reportData.savings / reportData.totalIncome) * 100).toFixed(1) + '%' : '0%',
        bgColor: colors.orange,
        borderColor: colors.orange,
        color: colors.white
      }
    ];

    drawSummaryCards(cards);

    // Income vs Expense Comparison
    pdf.moveDown(2);
    pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text('Income vs Expense Breakdown', 40, pdf.y);
    pdf.moveDown(1);

    const comparisonRows = [
      ['Monthly Income', formatCurrency(reportData.totalIncome), '100%'],
      ['Monthly Expense', formatCurrency(reportData.totalExpense), ((reportData.totalExpense / reportData.totalIncome) * 100).toFixed(0) + '%'],
      ['Net Savings', formatCurrency(reportData.savings), reportData.totalIncome > 0 ? ((reportData.savings / reportData.totalIncome) * 100).toFixed(1) + '%' : '0%']
    ];

    drawTable(
      ['Metric', 'Amount', 'Percentage'],
      comparisonRows,
      [0.4, 0.35, 0.25]
    );

    // Category-wise Expenses Table
    pdf.moveDown(2);
    pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text('Category-wise Expense Analysis', 40, pdf.y);
    pdf.moveDown(1);

    const categoryRows = Object.entries(reportData.categories || {})
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const pct = reportData.totalExpense > 0 
          ? ((amt / reportData.totalExpense) * 100).toFixed(1) 
          : 0;
        return [cat, formatCurrency(amt), `${pct}%`];
      });

    if (categoryRows.length > 0) {
      drawTable(
        ['Category', 'Amount', '% of Total'],
        categoryRows,
        [0.45, 0.3, 0.25]
      );
    } else {
      pdf.fontSize(11).fillColor(colors.gray).text('No expense data available', 40, pdf.y);
      pdf.moveDown(1);
    }

    drawFooter();
  }

  // ======== DATE RANGE REPORT ========
  else if (reportType === 'dateRange') {
    drawHeader();
    drawTitleSection();

    const incomeTx = reportData.transactions.filter(t => t.type === 'income').length;
    const expenseTx = reportData.transactions.filter(t => t.type !== 'income').length;

    const cards = [
      {
        label: 'Total Income:',
        amount: formatCurrency(reportData.totalIncome),
        bgColor: colors.green,
        borderColor: colors.green,
        color: colors.white
      },
      {
        label: 'Total Expenses:',
        amount: formatCurrency(reportData.totalExpense),
        bgColor: colors.red,
        borderColor: colors.red,
        color: colors.white
      },
      {
        label: 'Net Change:',
        amount: formatCurrency(reportData.savings),
        bgColor: reportData.savings >= 0 ? colors.green : colors.red,
        borderColor: reportData.savings >= 0 ? colors.green : colors.red,
        color: colors.white
      },
      {
        label: 'Total Transactions:',
        amount: reportData.transactionCount.toString(),
        subtext: `${incomeTx} income, ${expenseTx} expenses`,
        bgColor: colors.blue,
        borderColor: colors.blue,
        color: colors.white
      }
    ];

    drawSummaryCards(cards);

    // ALL Transaction List
    pdf.moveDown(1);
    pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text(`Transaction Details (${reportData.transactionCount} Total)`, 40, pdf.y);
    pdf.moveDown(1);

    const txRows = reportData.transactions.map(tx => [
      formatDate(tx.date),
      // Handle regex-matched types
      (/income/i.test(tx.type) ? 'Income' : /expense/i.test(tx.type) ? 'Expense' : tx.type).charAt(0).toUpperCase() + (/income/i.test(tx.type) ? 'Income' : /expense/i.test(tx.type) ? 'Expense' : tx.type).slice(1),
      (tx.category || 'Other').substring(0, 15),
      formatCurrency(tx.amount)
    ]);

    if (txRows.length > 0) {
      drawTable(
        ['Date', 'Type', 'Category', 'Amount'],
        txRows,
        [0.25, 0.2, 0.25, 0.3]
      );
    } else {
      pdf.fontSize(11).fillColor(colors.gray).text('No transactions found', 40, pdf.y);
      pdf.moveDown(1);
    }

    drawFooter();
  }

  // ======== BUDGET REPORT ========
  else if (reportType === 'budget') {
    drawHeader();
    drawTitleSection();

    // Calculate overspending details
    const isOverspent = reportData.totalSpent > reportData.monthlyBudget;
    const overspentAmount = isOverspent ? reportData.totalSpent - reportData.monthlyBudget : 0;
    const nextMonthRequirement = isOverspent ? overspentAmount : 0;
    const nextMonthSavingsNeeded = nextMonthRequirement > 0 ? ((nextMonthRequirement / reportData.monthlyBudget) * 100).toFixed(1) : 0;

    const cards = [
      {
        label: 'Fixed Budget:',
        amount: formatCurrency(reportData.monthlyBudget),
        bgColor: colors.blue,
        borderColor: colors.blue,
        color: colors.white
      },
      {
        label: 'Amount Spent:',
        amount: formatCurrency(reportData.totalSpent),
        bgColor: colors.red,
        borderColor: colors.red,
        color: colors.white
      },
      {
        label: isOverspent ? 'Overspent By:' : 'Budget Remaining:',
        amount: formatCurrency(Math.abs(reportData.remainingAmount)),
        bgColor: isOverspent ? colors.red : colors.green,
        borderColor: isOverspent ? colors.red : colors.green,
        color: colors.white,
        subtext: isOverspent ? 'EXCEEDED' : 'Safe'
      },
      {
        label: 'Budget Usage:',
        amount: reportData.percentageUsed + '%',
        bgColor: reportData.exceeded ? colors.red : colors.green,
        borderColor: reportData.exceeded ? colors.red : colors.green,
        color: colors.white
      }
    ];

    drawSummaryCards(cards);

    // Fixed Budget vs Actual Spending
    pdf.moveDown(2);
    pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text('Budget Status & Analysis', 40, pdf.y);
    pdf.moveDown(1);

    const budgetAnalysisData = [
      ['Fixed Monthly Budget', formatCurrency(reportData.monthlyBudget), '100%'],
      ['Amount Spent This Month', formatCurrency(reportData.totalSpent), reportData.percentageUsed + '%'],
      [isOverspent ? 'Overspent Amount' : 'Remaining Budget', formatCurrency(Math.abs(reportData.remainingAmount)), '—'],
      ['Monthly Income', formatCurrency(reportData.totalIncome), 'Reference'],
      ['Savings After Budget', formatCurrency(reportData.savings), (reportData.totalIncome > 0 ? ((reportData.savings / reportData.totalIncome) * 100).toFixed(1) : 0) + '%']
    ];

    drawTable(
      ['Metric', 'Amount', 'Status'],
      budgetAnalysisData,
      [0.4, 0.35, 0.25]
    );

    // Overspending Recovery Plan (if exceeded)
    if (isOverspent) {
      pdf.moveDown(2);
      pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
      pdf.text('Overspending Recovery Plan', 40, pdf.y);
      pdf.moveDown(1);

      const recoveryPlan = [
        ['This Month Overspent By', formatCurrency(overspentAmount), isOverspent ? '⚠️ Exceeded' : '✓ Safe'],
        ['Next Month Budget (Fixed)', formatCurrency(reportData.monthlyBudget), '100%'],
        ['Extra To Save Next Month', formatCurrency(nextMonthRequirement), nextMonthSavingsNeeded + '% of budget'],
        ['Target Spending For Recovery', formatCurrency(reportData.monthlyBudget - nextMonthRequirement), ((100 - nextMonthSavingsNeeded) + '%').toString()],
        ['Financial Strategy', 'Reduce by ' + nextMonthSavingsNeeded + '% to recover', 'Action Required']
      ];

      drawTable(
        ['Item', 'Amount / Action', 'Status'],
        recoveryPlan,
        [0.35, 0.4, 0.25]
      );
    }

    // Category-wise Expenses
    pdf.moveDown(2);
    pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text('Category-wise Expense Breakdown', 40, pdf.y);
    pdf.moveDown(1);

    const catExpenseRows = Object.entries(reportData.expensesByCategory || {})
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const pct = reportData.totalSpent > 0 
          ? ((amt / reportData.totalSpent) * 100).toFixed(1) 
          : 0;
        return [cat, formatCurrency(amt), `${pct}%`];
      });

    if (catExpenseRows.length > 0) {
      drawTable(
        ['Category', 'Amount', '% of Total'],
        catExpenseRows,
        [0.45, 0.3, 0.25]
      );
    }

    drawFooter();
  }

  // ======== FULL ACCOUNT REPORT ========
  else if (reportType === 'fullAccount') {
    drawHeader();
    drawTitleSection();

    const cards = [
      {
        label: 'Active Accounts:',
        amount: reportData.accountCount.toString(),
        bgColor: colors.blue,
        borderColor: colors.blue,
        color: colors.white
      },
      {
        label: 'Total Balance:',
        amount: formatCurrency(reportData.totalAccountBalance),
        bgColor: colors.green,
        borderColor: colors.green,
        color: colors.white
      },
      {
        label: 'Total Income:',
        amount: formatCurrency(reportData.totalIncome),
        bgColor: colors.green,
        borderColor: colors.green,
        color: colors.white
      },
      {
        label: 'Total Expenses:',
        amount: formatCurrency(reportData.totalExpense),
        bgColor: colors.red,
        borderColor: colors.red,
        color: colors.white
      }
    ];

    drawSummaryCards(cards);

    // Financial Summary
    pdf.moveDown(1);
    pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
    pdf.text('Financial Summary', 40, pdf.y);
    pdf.moveDown(1);

    const summaryData = [
      ['Total Income', formatCurrency(reportData.totalIncome)],
      ['Total Expense', formatCurrency(reportData.totalExpense)],
      ['Net Savings', formatCurrency(reportData.netBalance)],
      ['Total Transactions', reportData.transactionCount.toString()]
    ];

    drawTable(
      ['Metric', 'Value'],
      summaryData,
      [0.6, 0.4]
    );

    // Accounts Table
    if (reportData.accounts && reportData.accounts.length > 0) {
      pdf.moveDown(1);
      pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
      pdf.text('Account Details', 40, pdf.y);
      pdf.moveDown(1);

      const accountRows = reportData.accounts.map(acc => [
        acc.name,
        formatCurrency(acc.balance || 0),
        reportData.totalAccountBalance > 0 
          ? ((acc.balance / reportData.totalAccountBalance) * 100).toFixed(0) + '%'
          : '0%'
      ]);

      drawTable(['Account Name', 'Balance', 'Share'], accountRows, [0.4, 0.35, 0.25]);
    }

    // Category Summary
    if (Object.keys(reportData.categoryWiseSummary || {}).length > 0) {
      pdf.moveDown(1);
      pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
      pdf.text('Category-wise Expense Summary', 40, pdf.y);
      pdf.moveDown(1);

      const catSummaryRows = Object.entries(reportData.categoryWiseSummary || {})
        .map(([cat, amt]) => {
          const pct = reportData.totalExpense > 0 
            ? ((amt / reportData.totalExpense) * 100).toFixed(0) 
            : 0;
          return [cat, formatCurrency(amt), `${pct}%`];
        });

      drawTable(
        ['Category', 'Amount', '% of Total'],
        catSummaryRows,
        [0.5, 0.25, 0.25]
      );
    }

    // Bill Reminders
    if (reportData.reminders && reportData.reminders.length > 0) {
      pdf.moveDown(1);
      pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
      pdf.text('Bill Reminders', 40, pdf.y);
      pdf.moveDown(1);

      const reminderRows = reportData.reminders.slice(0, 10).map(reminder => [
        reminder.title || 'Unnamed',
        formatCurrency(reminder.amount || 0),
        reminder.dueDate ? formatDate(reminder.dueDate) : 'N/A',
        reminder.status || 'Pending'
      ]);

      drawTable(
        ['Reminder', 'Amount', 'Due Date', 'Status'],
        reminderRows,
        [0.35, 0.25, 0.2, 0.2]
      );
    }

    // Budget Summary
    if (reportData.budgets && reportData.budgets.length > 0) {
      pdf.moveDown(1);
      pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
      pdf.text('Budget Details', 40, pdf.y);
      pdf.moveDown(1);

      const budgetRows = reportData.budgets.slice(0, 12).map(budget => [
        `${getMonthName(budget.month)} ${budget.year}`,
        formatCurrency(budget.amount || 0),
        budget.status || 'Active'
      ]);

      drawTable(
        ['Month', 'Amount', 'Status'],
        budgetRows,
        [0.4, 0.35, 0.25]
      );
    }

    // All Transactions
    if (reportData.transactions && reportData.transactions.length > 0) {
      pdf.moveDown(1);
      pdf.fontSize(14).fillColor(colors.navy).font('Helvetica-Bold');
      pdf.text(`Transaction History (${reportData.transactionCount} Total)`, 40, pdf.y);
      pdf.moveDown(1);

      const allTxRows = reportData.transactions.map(tx => [
        formatDate(tx.date),
        tx.type.charAt(0).toUpperCase() + tx.type.slice(1),
        (tx.category || 'Other').substring(0, 12),
        formatCurrency(tx.amount)
      ]);

      drawTable(
        ['Date', 'Type', 'Category', 'Amount'],
        allTxRows,
        [0.25, 0.2, 0.25, 0.3]
      );
    }

    drawFooter();
  }

  pdf.end();
};

const generateExcel = async (reportType, reportData, res, fileName) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');

  // Header
  worksheet.columns = [
    { header: 'Money Manager Report', width: 25 },
    { header: `Generated: ${new Date().toLocaleString('en-IN')}`, width: 30 }
  ];

  let row = 3;

  if (reportType === 'monthly') {
    worksheet.getCell(`A${row}`).value = 'Monthly Financial Report';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 14 };
    row++;
    worksheet.getCell(`A${row}`).value = `Period: ${reportData.period}`;
    row += 2;

    // Financial Summary
    worksheet.getCell(`A${row}`).value = 'Financial Summary';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Monthly Income';
    worksheet.getCell(`B${row}`).value = reportData.totalIncome;
    worksheet.getCell(`B${row}`).font = { color: { rgb: 'FF00B050' } };
    row++;
    worksheet.getCell(`A${row}`).value = 'Monthly Expense';
    worksheet.getCell(`B${row}`).value = reportData.totalExpense;
    worksheet.getCell(`B${row}`).font = { color: { rgb: 'FFFF0000' } };
    row++;
    worksheet.getCell(`A${row}`).value = 'Savings';
    worksheet.getCell(`B${row}`).value = reportData.savings;
    worksheet.getCell(`B${row}`).font = { color: { rgb: 'FF0070C0' } };
    row++;
    const savingRate = reportData.totalIncome > 0 ? ((reportData.savings / reportData.totalIncome) * 100).toFixed(2) : 0;
    worksheet.getCell(`A${row}`).value = 'Savings Ratio (%)';
    worksheet.getCell(`B${row}`).value = savingRate;
    row += 2;

    // Income vs Expense Comparison
    worksheet.getCell(`A${row}`).value = 'Income vs Expense Analysis';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Metric';
    worksheet.getCell(`B${row}`).value = 'Amount';
    worksheet.getCell(`C${row}`).value = 'Percentage';
    worksheet.getCell(`A${row}`).font = { bold: true };
    worksheet.getCell(`B${row}`).font = { bold: true };
    worksheet.getCell(`C${row}`).font = { bold: true };
    row++;
    worksheet.getCell(`A${row}`).value = 'Monthly Income';
    worksheet.getCell(`B${row}`).value = reportData.totalIncome;
    worksheet.getCell(`C${row}`).value = '100%';
    row++;
    const expensePct = reportData.totalIncome > 0 ? ((reportData.totalExpense / reportData.totalIncome) * 100).toFixed(1) : 0;
    worksheet.getCell(`A${row}`).value = 'Monthly Expense';
    worksheet.getCell(`B${row}`).value = reportData.totalExpense;
    worksheet.getCell(`C${row}`).value = expensePct + '%';
    worksheet.getCell(`B${row}`).font = { color: { rgb: 'FFFF0000' } };
    row++;
    const savingsPct = reportData.totalIncome > 0 ? ((reportData.savings / reportData.totalIncome) * 100).toFixed(1) : 0;
    worksheet.getCell(`A${row}`).value = 'Net Savings';
    worksheet.getCell(`B${row}`).value = reportData.savings;
    worksheet.getCell(`C${row}`).value = savingsPct + '%';
    worksheet.getCell(`B${row}`).font = { color: { rgb: 'FF00B050' } };
    row += 2;

    // Category-wise Expenses
    if (Object.keys(reportData.categories).length > 0) {
      worksheet.getCell(`A${row}`).value = 'Category-wise Expense Analysis';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Category';
      worksheet.getCell(`B${row}`).value = 'Amount';
      worksheet.getCell(`C${row}`).value = '% of Total';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      row++;

      Object.entries(reportData.categories).forEach(([category, amount]) => {
        const pct = reportData.totalExpense > 0 ? ((amount / reportData.totalExpense) * 100).toFixed(2) : 0;
        worksheet.getCell(`A${row}`).value = category;
        worksheet.getCell(`B${row}`).value = amount;
        worksheet.getCell(`C${row}`).value = pct;
        row++;
      });
    }

  } else if (reportType === 'dateRange') {
    worksheet.getCell(`A${row}`).value = 'Transaction Report';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 14 };
    row++;
    worksheet.getCell(`A${row}`).value = `Period: ${reportData.period}`;
    row += 2;

    worksheet.getCell(`A${row}`).value = 'Financial Summary';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Income';
    worksheet.getCell(`B${row}`).value = reportData.totalIncome;
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Expense';
    worksheet.getCell(`B${row}`).value = reportData.totalExpense;
    row++;
    worksheet.getCell(`A${row}`).value = 'Net Change';
    worksheet.getCell(`B${row}`).value = reportData.savings;
    row++;
    worksheet.getCell(`A${row}`).value = 'Transaction Count';
    worksheet.getCell(`B${row}`).value = reportData.transactionCount;
    row += 2;

    // ALL Transactions
    worksheet.getCell(`A${row}`).value = `All Transactions (${reportData.transactionCount})`;
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Date';
    worksheet.getCell(`B${row}`).value = 'Type';
    worksheet.getCell(`C${row}`).value = 'Category';
    worksheet.getCell(`D${row}`).value = 'Amount';
    worksheet.getCell(`A${row}`).font = { bold: true };
    worksheet.getCell(`B${row}`).font = { bold: true };
    worksheet.getCell(`C${row}`).font = { bold: true };
    worksheet.getCell(`D${row}`).font = { bold: true };
    row++;

    reportData.transactions.forEach((tx) => {
      worksheet.getCell(`A${row}`).value = formatDate(tx.date);
      const typeDisplay = (/income/i.test(tx.type) ? 'Income' : /expense/i.test(tx.type) ? 'Expense' : tx.type);
      worksheet.getCell(`B${row}`).value = typeDisplay.charAt(0).toUpperCase() + typeDisplay.slice(1);
      worksheet.getCell(`C${row}`).value = tx.category || 'Other';
      worksheet.getCell(`D${row}`).value = tx.amount;
      row++;
    });

  } else if (reportType === 'budget') {
    worksheet.getCell(`A${row}`).value = 'Budget Analysis Report';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 14 };
    row++;
    worksheet.getCell(`A${row}`).value = `Period: ${reportData.period}`;
    row += 2;

    // Calculate overspending
    const isOverspent = reportData.totalSpent > reportData.monthlyBudget;
    const overspentAmount = isOverspent ? reportData.totalSpent - reportData.monthlyBudget : 0;
    const nextMonthRequirement = isOverspent ? overspentAmount : 0;
    const nextMonthSavingsNeeded = nextMonthRequirement > 0 ? ((nextMonthRequirement / reportData.monthlyBudget) * 100).toFixed(1) : 0;

    // Budget Status
    worksheet.getCell(`A${row}`).value = 'Budget Status & Analysis';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Fixed Monthly Budget';
    worksheet.getCell(`B${row}`).value = reportData.monthlyBudget;
    row++;
    worksheet.getCell(`A${row}`).value = 'Amount Spent This Month';
    worksheet.getCell(`B${row}`).value = reportData.totalSpent;
    row++;
    worksheet.getCell(`A${row}`).value = isOverspent ? 'Overspent Amount' : 'Remaining Budget';
    worksheet.getCell(`B${row}`).value = Math.abs(reportData.remainingAmount);
    worksheet.getCell(`B${row}`).font = { color: { rgb: isOverspent ? 'FFFF0000' : 'FF00B050' } };
    row++;
    worksheet.getCell(`A${row}`).value = 'Budget Usage %';
    worksheet.getCell(`B${row}`).value = reportData.percentageUsed;
    worksheet.getCell(`B${row}`).font = { color: { rgb: reportData.exceeded ? 'FFFF0000' : 'FF00B050' } };
    row++;
    worksheet.getCell(`A${row}`).value = 'Monthly Income';
    worksheet.getCell(`B${row}`).value = reportData.totalIncome;
    row++;
    worksheet.getCell(`A${row}`).value = 'Savings';
    worksheet.getCell(`B${row}`).value = reportData.savings;
    row += 2;

    // Overspending Recovery Plan
    if (isOverspent) {
      worksheet.getCell(`A${row}`).value = 'Overspending Recovery Plan';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12, color: { rgb: 'FFFF0000' } };
      row++;
      worksheet.getCell(`A${row}`).value = 'This Month Overspent By';
      worksheet.getCell(`B${row}`).value = overspentAmount;
      worksheet.getCell(`B${row}`).font = { color: { rgb: 'FFFF0000' } };
      row++;
      worksheet.getCell(`A${row}`).value = 'Next Month Fixed Budget';
      worksheet.getCell(`B${row}`).value = reportData.monthlyBudget;
      row++;
      worksheet.getCell(`A${row}`).value = 'Extra To Save Next Month';
      worksheet.getCell(`B${row}`).value = nextMonthRequirement;
      worksheet.getCell(`C${row}`).value = nextMonthSavingsNeeded + '% of budget';
      worksheet.getCell(`B${row}`).font = { color: { rgb: 'FF0070C0' } };
      row++;
      worksheet.getCell(`A${row}`).value = 'Target Spending For Recovery';
      worksheet.getCell(`B${row}`).value = reportData.monthlyBudget - nextMonthRequirement;
      worksheet.getCell(`C${row}`).value = ((100 - nextMonthSavingsNeeded) + '%');
      row++;
      worksheet.getCell(`A${row}`).value = 'Financial Strategy';
      worksheet.getCell(`B${row}`).value = 'Reduce spending by ' + nextMonthSavingsNeeded + '% next month';
      worksheet.getCell(`C${row}`).value = 'Action Required';
      row += 2;
    }

    // Category-wise Expenses
    if (reportData.expensesByCategory && Object.keys(reportData.expensesByCategory).length > 0) {
      worksheet.getCell(`A${row}`).value = 'Category-wise Expense Breakdown';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Category';
      worksheet.getCell(`B${row}`).value = 'Amount';
      worksheet.getCell(`C${row}`).value = '% of Total';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      row++;

      Object.entries(reportData.expensesByCategory).forEach(([category, amount]) => {
        const pct = reportData.totalSpent > 0 ? ((amount / reportData.totalSpent) * 100).toFixed(2) : 0;
        worksheet.getCell(`A${row}`).value = category;
        worksheet.getCell(`B${row}`).value = amount;
        worksheet.getCell(`C${row}`).value = pct;
        row++;
      });
    }

  } else if (reportType === 'fullAccount') {
    worksheet.getCell(`A${row}`).value = 'Full Account Report';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 14 };
    row += 2;

    // Account Summary
    worksheet.getCell(`A${row}`).value = 'Account Summary';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Username';
    worksheet.getCell(`B${row}`).value = reportData.userName;
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Accounts';
    worksheet.getCell(`B${row}`).value = reportData.accountCount;
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Balance';
    worksheet.getCell(`B${row}`).value = reportData.totalAccountBalance;
    row += 2;

    // Financial Summary
    worksheet.getCell(`A${row}`).value = 'Financial Summary';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Income';
    worksheet.getCell(`B${row}`).value = reportData.totalIncome;
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Expense';
    worksheet.getCell(`B${row}`).value = reportData.totalExpense;
    row++;
    worksheet.getCell(`A${row}`).value = 'Net Savings';
    worksheet.getCell(`B${row}`).value = reportData.netBalance;
    row++;
    worksheet.getCell(`A${row}`).value = 'Total Transactions';
    worksheet.getCell(`B${row}`).value = reportData.transactionCount;
    row += 2;

    // Accounts
    if (reportData.accounts && reportData.accounts.length > 0) {
      worksheet.getCell(`A${row}`).value = 'Account Details';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Account Name';
      worksheet.getCell(`B${row}`).value = 'Balance';
      worksheet.getCell(`C${row}`).value = '% Share';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      row++;
      reportData.accounts.forEach((acc) => {
        worksheet.getCell(`A${row}`).value = acc.name;
        worksheet.getCell(`B${row}`).value = acc.balance;
        const share = reportData.totalAccountBalance > 0 ? ((acc.balance / reportData.totalAccountBalance) * 100).toFixed(2) : 0;
        worksheet.getCell(`C${row}`).value = share;
        row++;
      });
      row += 2;
    }

    // Category Summary
    if (reportData.categoryWiseSummary && Object.keys(reportData.categoryWiseSummary).length > 0) {
      worksheet.getCell(`A${row}`).value = 'Category-wise Summary';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Category';
      worksheet.getCell(`B${row}`).value = 'Amount';
      worksheet.getCell(`C${row}`).value = '% of Expenses';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      row++;
      Object.entries(reportData.categoryWiseSummary).forEach(([category, amount]) => {
        const pct = reportData.totalExpense > 0 ? ((amount / reportData.totalExpense) * 100).toFixed(2) : 0;
        worksheet.getCell(`A${row}`).value = category;
        worksheet.getCell(`B${row}`).value = amount;
        worksheet.getCell(`C${row}`).value = pct;
        row++;
      });
      row += 2;
    }

    // Bill Reminders
    if (reportData.reminders && reportData.reminders.length > 0) {
      worksheet.getCell(`A${row}`).value = 'Bill Reminders';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Reminder';
      worksheet.getCell(`B${row}`).value = 'Amount';
      worksheet.getCell(`C${row}`).value = 'Due Date';
      worksheet.getCell(`D${row}`).value = 'Status';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      worksheet.getCell(`D${row}`).font = { bold: true };
      row++;
      reportData.reminders.slice(0, 20).forEach((reminder) => {
        worksheet.getCell(`A${row}`).value = reminder.title || 'Unnamed';
        worksheet.getCell(`B${row}`).value = reminder.amount || 0;
        worksheet.getCell(`C${row}`).value = reminder.dueDate ? formatDate(reminder.dueDate) : 'N/A';
        worksheet.getCell(`D${row}`).value = reminder.status || 'Pending';
        row++;
      });
      row += 2;
    }

    // Budgets
    if (reportData.budgets && reportData.budgets.length > 0) {
      worksheet.getCell(`A${row}`).value = 'Budget Details';
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Month';
      worksheet.getCell(`B${row}`).value = 'Amount';
      worksheet.getCell(`C${row}`).value = 'Status';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      row++;
      reportData.budgets.slice(0, 12).forEach((budget) => {
        worksheet.getCell(`A${row}`).value = `${getMonthName(budget.month)} ${budget.year}`;
        worksheet.getCell(`B${row}`).value = budget.amount || 0;
        worksheet.getCell(`C${row}`).value = budget.status || 'Active';
        row++;
      });
      row += 2;
    }

    // All Transactions
    if (reportData.transactions && reportData.transactions.length > 0) {
      worksheet.getCell(`A${row}`).value = `Transaction History (${reportData.transactionCount})`;
      worksheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;
      worksheet.getCell(`A${row}`).value = 'Date';
      worksheet.getCell(`B${row}`).value = 'Type';
      worksheet.getCell(`C${row}`).value = 'Category';
      worksheet.getCell(`D${row}`).value = 'Amount';
      worksheet.getCell(`A${row}`).font = { bold: true };
      worksheet.getCell(`B${row}`).font = { bold: true };
      worksheet.getCell(`C${row}`).font = { bold: true };
      worksheet.getCell(`D${row}`).font = { bold: true };
      row++;
      reportData.transactions.forEach((tx) => {
        worksheet.getCell(`A${row}`).value = formatDate(tx.date);
        worksheet.getCell(`B${row}`).value = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
        worksheet.getCell(`C${row}`).value = tx.category || 'Other';
        worksheet.getCell(`D${row}`).value = tx.amount;
        row++;
      });
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  await workbook.xlsx.write(res);
};

const generateCSV = (reportType, reportData, res, fileName) => {
  let csvData = [];

  if (reportType === 'monthly') {
    csvData = [
      ['Monthly Financial Report', reportData.period],
      [],
      ['Financial Summary'],
      ['Total Income', reportData.totalIncome],
      ['Total Expense', reportData.totalExpense],
      ['Savings', reportData.savings],
      ['Saving Rate (%)', reportData.totalIncome > 0 ? ((reportData.savings / reportData.totalIncome) * 100).toFixed(2) : 0],
      []
    ];

    if (Object.keys(reportData.categories).length > 0) {
      csvData.push(['Category-wise Expenses']);
      csvData.push(['Category', 'Amount', '% of Total']);
      Object.entries(reportData.categories).forEach(([category, amount]) => {
        const pct = reportData.totalExpense > 0 ? ((amount / reportData.totalExpense) * 100).toFixed(2) : 0;
        csvData.push([category, amount, pct]);
      });
      csvData.push([]);
    }

    if (Object.keys(reportData.groupedByDay || {}).length > 0) {
      csvData.push(['Daily Summary']);
      csvData.push(['Date', 'Income', 'Expense', 'Net']);
      Object.entries(reportData.groupedByDay || {}).sort((a, b) => a[0] - b[0]).forEach(([day, data]) => {
        csvData.push([`${getMonthName(reportData.month)} ${day}, ${reportData.year}`, data.income, data.expense, data.income - data.expense]);
      });
    }

  } else if (reportType === 'dateRange') {
    csvData = [
      ['Transaction Report', reportData.period],
      [],
      ['Financial Summary'],
      ['Total Income', reportData.totalIncome],
      ['Total Expense', reportData.totalExpense],
      ['Net Change', reportData.savings],
      ['Total Transactions', reportData.transactionCount],
      [],
      [`All Transactions (${reportData.transactionCount})`],
      ['Date', 'Type', 'Category', 'Amount', 'Account', 'Description']
    ];
    reportData.transactions.forEach((tx) => {
      csvData.push([
        formatDate(tx.date),
        tx.type,
        tx.category || '',
        tx.amount,
        tx.account || '',
        tx.description || ''
      ]);
    });

  } else if (reportType === 'budget') {
    csvData = [
      ['Budget Analysis Report', reportData.period],
      [],
      ['Budget Summary'],
      ['Total Income', reportData.totalIncome],
      ['Total Expense', reportData.totalExpense],
      ['Savings', reportData.savings],
      ['Approved Budget', reportData.monthlyBudget],
      ['Amount Spent', reportData.totalSpent],
      ['Remaining Budget', reportData.remainingAmount],
      ['Usage %', reportData.percentageUsed],
      ['Budget Status', reportData.exceeded ? 'EXCEEDED' : 'Within Limit'],
      []
    ];

    if (reportData.expensesByCategory && Object.keys(reportData.expensesByCategory).length > 0) {
      csvData.push(['Category-wise Expenses']);
      csvData.push(['Category', 'Amount', '% of Budget']);
      Object.entries(reportData.expensesByCategory).forEach(([category, amount]) => {
        const pct = reportData.totalSpent > 0 ? ((amount / reportData.totalSpent) * 100).toFixed(2) : 0;
        csvData.push([category, amount, pct]);
      });
    }

  } else if (reportType === 'fullAccount') {
    csvData = [
      ['Full Account Report'],
      [],
      ['Account Summary'],
      ['Username', reportData.userName],
      ['Total Accounts', reportData.accountCount],
      ['Total Balance', reportData.totalAccountBalance],
      [],
      ['Financial Summary'],
      ['Total Income', reportData.totalIncome],
      ['Total Expense', reportData.totalExpense],
      ['Net Savings', reportData.netBalance],
      ['Total Transactions', reportData.transactionCount],
      []
    ];

    if (reportData.accounts && reportData.accounts.length > 0) {
      csvData.push(['Account Details']);
      csvData.push(['Account Name', 'Balance', '% Share']);
      reportData.accounts.forEach((acc) => {
        const share = reportData.totalAccountBalance > 0 ? ((acc.balance / reportData.totalAccountBalance) * 100).toFixed(2) : 0;
        csvData.push([acc.name, acc.balance, share]);
      });
      csvData.push([]);
    }

    if (reportData.categoryWiseSummary && Object.keys(reportData.categoryWiseSummary).length > 0) {
      csvData.push(['Category-wise Summary']);
      csvData.push(['Category', 'Amount', '% of Expenses']);
      Object.entries(reportData.categoryWiseSummary).forEach(([category, amount]) => {
        const pct = reportData.totalExpense > 0 ? ((amount / reportData.totalExpense) * 100).toFixed(2) : 0;
        csvData.push([category, amount, pct]);
      });
      csvData.push([]);
    }

    if (reportData.reminders && reportData.reminders.length > 0) {
      csvData.push(['Bill Reminders']);
      csvData.push(['Reminder', 'Amount', 'Due Date', 'Status']);
      reportData.reminders.slice(0, 20).forEach((reminder) => {
        csvData.push([
          reminder.title || 'Unnamed',
          reminder.amount || 0,
          reminder.dueDate ? formatDate(reminder.dueDate) : 'N/A',
          reminder.status || 'Pending'
        ]);
      });
      csvData.push([]);
    }

    if (reportData.budgets && reportData.budgets.length > 0) {
      csvData.push(['Budget Details']);
      csvData.push(['Month', 'Amount', 'Status']);
      reportData.budgets.slice(0, 12).forEach((budget) => {
        csvData.push([`${getMonthName(budget.month)} ${budget.year}`, budget.amount || 0, budget.status || 'Active']);
      });
      csvData.push([]);
    }

    if (reportData.transactions && reportData.transactions.length > 0) {
      csvData.push([`Transaction History (${reportData.transactionCount})`]);
      csvData.push(['Date', 'Type', 'Category', 'Amount']);
      reportData.transactions.forEach((tx) => {
        csvData.push([
          formatDate(tx.date),
          tx.type,
          tx.category || 'Other',
          tx.amount
        ]);
      });
    }
  }

  const csvContent = stringify(csvData);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(csvContent);
};

// ============================================
// ROUTES
// ============================================

// Monthly Report
router.post('/monthly', auth, async (req, res) => {
  try {
    const { month, year, format } = req.body;
    const userId = req.user.id;

    if (!month || !year || !format) {
      return res.status(400).json({ message: 'Missing required fields: month, year, format' });
    }

    const reportData = await getMonthlyReportData(userId, month, year);
    const periodStr = `${getMonthName(month)}_${year}`;
    const fileName = `Monthly_Report_${periodStr}.${format === 'pdf' ? 'pdf' : format === 'excel' ? 'xlsx' : 'csv'}`;

    if (format === 'pdf') {
      generatePDF('monthly', reportData, res, fileName);
    } else if (format === 'excel') {
      await generateExcel('monthly', reportData, res, fileName);
    } else if (format === 'csv') {
      generateCSV('monthly', reportData, res, fileName);
    } else {
      return res.status(400).json({ message: 'Invalid format. Use: pdf, excel, or csv' });
    }
  } catch (err) {
    console.error('Error generating monthly report:', err);
    res.status(500).json({ message: 'Error generating report', error: err.message });
  }
});

// Date Range Report
router.post('/daterange', auth, async (req, res) => {
  try {
    const { fromDate, toDate, format } = req.body;
    const userId = req.user.id;

    if (!fromDate || !toDate || !format) {
      return res.status(400).json({ message: 'Missing required fields: fromDate, toDate, format' });
    }

    const reportData = await getDateRangeReportData(userId, fromDate, toDate);
    const fileName = `DateRange_Report_${formatDate(fromDate)}_to_${formatDate(toDate)}.${format === 'pdf' ? 'pdf' : format === 'excel' ? 'xlsx' : 'csv'}`;

    if (format === 'pdf') {
      generatePDF('dateRange', reportData, res, fileName);
    } else if (format === 'excel') {
      await generateExcel('dateRange', reportData, res, fileName);
    } else if (format === 'csv') {
      generateCSV('dateRange', reportData, res, fileName);
    } else {
      return res.status(400).json({ message: 'Invalid format. Use: pdf, excel, or csv' });
    }
  } catch (err) {
    console.error('Error generating date range report:', err);
    res.status(500).json({ message: 'Error generating report', error: err.message });
  }
});

// Budget Report
router.post('/budget', auth, async (req, res) => {
  try {
    const { month, year, format } = req.body;
    const userId = req.user.id;

    if (!month || !year || !format) {
      return res.status(400).json({ message: 'Missing required fields: month, year, format' });
    }

    const reportData = await getBudgetReportData(userId, month, year);
    const periodStr = `${getMonthName(month)}_${year}`;
    const fileName = `Budget_Report_${periodStr}.${format === 'pdf' ? 'pdf' : format === 'excel' ? 'xlsx' : 'csv'}`;

    if (format === 'pdf') {
      generatePDF('budget', reportData, res, fileName);
    } else if (format === 'excel') {
      await generateExcel('budget', reportData, res, fileName);
    } else if (format === 'csv') {
      generateCSV('budget', reportData, res, fileName);
    } else {
      return res.status(400).json({ message: 'Invalid format. Use: pdf, excel, or csv' });
    }
  } catch (err) {
    console.error('Error generating budget report:', err);
    res.status(500).json({ message: 'Error generating report', error: err.message });
  }
});

// Full Account Report
router.post('/fullaccount', auth, async (req, res) => {
  try {
    const { fromDate, toDate, format } = req.body;
    const userId = req.user.id;

    if (!format) {
      return res.status(400).json({ message: 'Missing required field: format' });
    }

    const reportData = await getFullAccountReportData(userId, fromDate || null, toDate || null);
    let fileName = `Full_Account_Report`;
    if (fromDate && toDate) {
      fileName += `_${formatDate(fromDate)}_to_${formatDate(toDate)}`;
    }
    fileName += `.${format === 'pdf' ? 'pdf' : format === 'excel' ? 'xlsx' : 'csv'}`;

    if (format === 'pdf') {
      generatePDF('fullAccount', reportData, res, fileName);
    } else if (format === 'excel') {
      await generateExcel('fullAccount', reportData, res, fileName);
    } else if (format === 'csv') {
      generateCSV('fullAccount', reportData, res, fileName);
    } else {
      return res.status(400).json({ message: 'Invalid format. Use: pdf, excel, or csv' });
    }
  } catch (err) {
    console.error('Error generating full account report:', err);
    res.status(500).json({ message: 'Error generating report', error: err.message });
  }
});

module.exports = router;
