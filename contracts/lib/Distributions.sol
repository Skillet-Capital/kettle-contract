// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Kettle Loan Payment Distribution Library
 * @author diamondjim.eth
 * @notice Distributes payments from payers to payees based on predefined tranches
 */
library Distributions {
    
    /**
     * @notice Distributes loan payments to lenders and recipients.
     *
     * @param currency The address of the currency in which payments are made.
     * @param amount The total amount to distribute, which may include debt, principal, past interest, past fee, current interest, and current fee.
     * @param debt The outstanding debt to be covered by the distribution.
     * @param lenderDebt Total amount owed to lender
     * @param feeDebt Total amount owed to fee recipient
     * @param lender The address of the lender.
     * @param feeRecipient The address of the fee recipient.
     * @param primaryPayer The primary payer responsible for covering the outstanding debt.
     * @param residualPayer The payer responsible for covering the residual amount.
     * @param residualRecipient The recipient of the residual amount.
     *
     * Requirements:
     * - The provided amounts and addresses must align with the specified parameters.
     *
     * @dev The function distributes the provided amount among lenders and recipients based on predefined tranches. Tranches include principal, interest, and fee components.
     * It takes into account the outstanding debt and ensures proper distribution to both the primary and residual payers.
     * The function calculates and transfers the amounts accordingly, considering different scenarios based on the relationship between the total amount and the tranches.
     */
    function distributeLoanPayments(
        address currency,
        uint256 amount,
        uint256 debt,
        uint256 lenderDebt,
        uint256 feeDebt,
        address lender,
        address feeRecipient,
        address primaryPayer,
        address residualPayer,
        address residualRecipient
    ) external {
        
        if (amount < debt) {
            // +-------------------------------------------------+
            // |                                      amount     |
            // |----------------------------------|---↓----------|
            // |        principal + interest      |   fee        |
            // +-------------------------------------------------+

            if (amount > lenderDebt) {
                _transferCurrency(currency, primaryPayer, lender, lenderDebt);

                uint256 feePayoff = amount - lenderDebt;
                uint256 residualFeePayoff = feeDebt - feePayoff;

                _transferCurrency(currency, primaryPayer, feeRecipient, feePayoff);
                _transferCurrency(currency, residualPayer, feeRecipient, residualFeePayoff);
            }

            // +-------------------------------------------------+
            // |        amount                    |              |
            // |--------↓-------------------------|--------------|
            // |        principal + interest      |   fee        |
            // +-------------------------------------------------+

            else {
                _transferCurrency(currency, primaryPayer, lender, amount);

                uint256 residualPayoff = lenderDebt - amount;
                _transferCurrency(currency, residualPayer, lender, residualPayoff);
                _transferCurrency(currency, residualPayer, feeRecipient, feeDebt);
            }

        } else {
            uint256 netPrincipalReceived = amount - debt;
            _transferCurrency(currency, primaryPayer, residualRecipient, netPrincipalReceived);
            _transferCurrency(currency, primaryPayer, lender, lenderDebt);
            _transferCurrency(currency, primaryPayer, feeRecipient, feeDebt);
        }
    }

    function _transferCurrency(
        address currency,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (from == to) return;
        if (amount == 0) return;

        if (from == address(this)) IERC20(currency).transfer(to, amount);
        else IERC20(currency).transferFrom(from, to, amount);
    }
}
