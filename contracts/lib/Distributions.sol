// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Kettle Loan Payment Distribution Library
 * @author diamondjim.eth
 * @notice Distributes payments from payers to payees based on predefined tranches
 */
library Distributions {

    struct DistributionTranche {
        uint256 amount;
        address recipient;
    }
    
    /**
     * @notice Distributes loan payments to lenders and recipients.
     *
     * @param currency The address of the currency in which payments are made.
     * @param amount The total amount to distribute, which may include debt, principal, past interest, past fee, current interest, and current fee.
     * @param debt The outstanding debt to be covered by the distribution.
     * @param principal The principal amount to be distributed.
     * @param interest The accumulated interest amount
     * @param fee The accumulated fee amount
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
        uint256 principal,
        uint256 interest,
        uint256 fee,
        address lender,
        address feeRecipient,
        address primaryPayer,
        address residualPayer,
        address residualRecipient
    ) external {
        if (amount < debt) {

            DistributionTranche[3] memory tranches = _createTranches(
                principal, 
                lender,
                interest, 
                lender, 
                fee, 
                feeRecipient
            );

            // +-----------------------------------------------------------+
            // |                                              amount       |
            // |-------------------------|-----------------|----↓----------|
            // |        tranches[0]      |   tranches[1]   |   tranches[2] |
            // +-----------------------------------------------------------+

            if (amount > tranches[0].amount + tranches[1].amount) {
                _transferCurrency(currency, primaryPayer, tranches[0].recipient, tranches[0].amount);
                _transferCurrency(currency, primaryPayer, tranches[1].recipient, tranches[1].amount);

                uint256 lenderTranchePayment = amount - (tranches[0].amount + tranches[1].amount);
                uint256 residualTranchePayment = tranches[2].amount - lenderTranchePayment;

                _transferCurrency(currency, primaryPayer, tranches[2].recipient, lenderTranchePayment);
                _transferCurrency(currency, residualPayer, tranches[2].recipient, residualTranchePayment);
            }

            // +-----------------------------------------------------------+
            // |                             amount                        |
            // |-------------------------|-----↓-----------|---------------|
            // |        tranches[0]      |   tranches[1]   |   tranches[2] |
            // +-----------------------------------------------------------+

            else if (amount > tranches[0].amount) {
                _transferCurrency(currency, primaryPayer, tranches[0].recipient, tranches[0].amount);

                uint256 lenderTranchePayment = amount - tranches[0].amount;
                uint256 residualTranchePayment = tranches[1].amount - lenderTranchePayment;

                _transferCurrency(currency, primaryPayer, tranches[1].recipient, lenderTranchePayment);
                _transferCurrency(currency, residualPayer, tranches[1].recipient, residualTranchePayment);

                _transferCurrency(currency, residualPayer, tranches[2].recipient, tranches[2].amount);
            }

            // +-----------------------------------------------------------+
            // |       amount                                              |
            // |---------↓---------------|-----------------|---------------|
            // |        tranches[0]      |   tranches[1]   |   tranches[2] |
            // +-----------------------------------------------------------+

            else {
                uint256 lenderTranchePayment = amount;
                uint256 residualTranchePayment = tranches[0].amount - lenderTranchePayment;

                _transferCurrency(currency, primaryPayer, tranches[0].recipient, lenderTranchePayment);
                _transferCurrency(currency, residualPayer, tranches[0].recipient, residualTranchePayment);

                _transferCurrency(currency, residualPayer, tranches[1].recipient, tranches[1].amount);
                _transferCurrency(currency, residualPayer, tranches[2].recipient, tranches[2].amount);
            }

        } else {
            uint256 netPrincipalReceived = amount - debt;
            _transferCurrency(currency, primaryPayer, residualRecipient, netPrincipalReceived);
            _transferCurrency(currency, primaryPayer, lender, interest + principal);
            _transferCurrency(currency, primaryPayer, feeRecipient, fee);
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

    function _createTranches(
        uint256 principal,
        address principalRecipient,
        uint256 interest,
        address interestRecipient,
        uint256 fee,
        address feeRecipient
    ) internal pure returns (DistributionTranche[3] memory) {
        DistributionTranche[3] memory tranches;

        // Create an array of structs to store the amounts and recipients
        DistributionTranche[3] memory amountsAndRecipients = [
            DistributionTranche(principal, principalRecipient),
            DistributionTranche(interest, interestRecipient),
            DistributionTranche(fee, feeRecipient)
        ];

        // Sort the array in descending order based on amounts
        sortAmounts(amountsAndRecipients);

        // Assign values to tranches
        for (uint256 i = 0; i < 3; i++) {
            tranches[i] = amountsAndRecipients[i];
        }

        return tranches;
    }

    function sortAmounts(DistributionTranche[3] memory arr) internal pure {
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (arr[i].amount < arr[j].amount) {
                    (arr[i], arr[j]) = (arr[j], arr[i]);
                }
            }
        }
    }
}
