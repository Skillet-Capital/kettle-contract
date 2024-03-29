// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { wadMul, wadDiv } from "solmate/src/utils/SignedWadMath.sol";

/**
 * @title Kettle FixedInterest Model
 * @author diamondjim.eth
 * @notice Implements the fixed interest model for Kettle loans.
 */
library FixedInterest {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    /**
     * @notice Computes the past and current interest and fees for a loan installment.
     *
     * @param startTime The timestamp when the loan installment plan started.
     * @param installment The current installment number.
     * @param period The duration of each installment period.
     * @param installments The total number of installments in the loan plan.
     * @param rate The interest rate applied to the loan.
     * @param defaultRate The interest rate applied in case of default.
     * @param fee The fee rate applied to the loan.
     * @param principal The loan principal amount.
     *
     * @return pastInterest The accumulated interest up to the current installment due to default (if any),
     * @return pastFee The accumulated fee up to the current installment due to default (if any),
     * @return currentInterest The interest amount for the current installment,
     * @return currentFee The fee amount for the current installment
     *
     * @dev The function calculates past and current interest and fees based on the provided loan parameters.
     * If the loan is in default, it calculates past interest and fee amounts.
     * If the loan is within the installment period, it calculates current interest and fee amounts.
     */
    function computeInterestAndFees(
        uint256 startTime,
        uint256 installment,
        uint256 period,
        uint256 installments,
        uint256 rate,
        uint256 defaultRate,
        uint256 fee,
        uint256 principal,
        bool repayment
    )
        public 
        view 
        returns (
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) 
    {   
        uint256 paidThrough = startTime + (installment * period);
        uint256 tenor = period * installments;

        if (repayment && block.timestamp < paidThrough) {
            return (0, 0, 0, 0);
        }

        bool inDefault = (block.timestamp > paidThrough + period) ? true : false;
        bool pastTenor = (block.timestamp > startTime + tenor) ? true : false;

        // charge default rate if past payment is past due
        if (inDefault) {
            pastInterest = computeCurrentDebt(principal, defaultRate, period) - principal;
            pastFee = computeCurrentDebt(principal, fee, period) - principal;
        }

        // charge regular rate if loan is in normal state
        if (!pastTenor) {
            currentInterest = computeCurrentDebt(principal, rate, period) - principal;
            currentFee = computeCurrentDebt(principal, fee, period) - principal;
        }
    }

    // /**
    //  * @notice Computes the current amount owed to pay off the loan.
    //  *
    //  * @param startTime The timestamp when the loan installment plan started.
    //  * @param installment The current installment number.
    //  * @param period The duration of each installment period.
    //  * @param installments The total number of installments in the loan plan.
    //  * @param rate The interest rate applied to the loan.
    //  * @param defaultRate The interest rate applied in case of default.
    //  * @param fee The fee rate applied to the loan.
    //  * @param principal The loan principal amount.
    //  *
    //  * @return pastInterest The accumulated interest up to the current installment due to default (if any),
    //  * @return pastFee The accumulated fee up to the current installment due to default (if any),
    //  * @return currentInterest The interest amount for the current installment,
    //  * @return currentFee The fee amount for the current installment
    //  *
    //  * @dev The function calculates past and current interest and fees based on the provided loan parameters.
    //  * If the loan is paid up to date, it returns zero for past and current interest and fees.
    //  * If the loan is in default, it calculates past interest and fee amounts.
    //  * If the loan is within the installment period, it calculates current interest and fee amounts.
    //  */
    // function computeRepayment(
    //     uint256 startTime,
    //     uint256 installment,
    //     uint256 period,
    //     uint256 installments,
    //     uint256 rate,
    //     uint256 defaultRate,
    //     uint256 fee,
    //     uint256 principal
    // ) public view returns (
    //     uint256 pastInterest,
    //     uint256 pastFee,
    //     uint256 currentInterest,
    //     uint256 currentFee
    // ) {

    //     uint256 paidThrough = startTime + (installment * period);
    //     if (block.timestamp < paidThrough) {
    //         pastInterest = 0;
    //         pastFee = 0;
    //         currentInterest = 0;
    //         currentFee = 0;
    //         return (pastInterest, pastFee, currentInterest, currentFee);
    //     }

    //     (
    //         pastInterest,
    //         pastFee,
    //         currentInterest,
    //         currentFee
    //     ) = computeInterestAndFees(startTime, installment, period, installments, rate, defaultRate, fee, principal);
    // }

    /**
     * @dev Computes the current debt of a borrow given the last time it was touched and the last computed debt.
     * @param amount Principal amount
     * @param rate Interest rate (in bips)
     * @param period Period in seconds
     */
    function computeCurrentDebt(
        uint256 amount,
        uint256 rate,
        uint256 period
    ) public pure returns (uint256) {
        int256 yearsWad = wadDiv(int256(period) * 1e18, _YEAR_WAD);
        return amount + uint256(wadMul(int256(amount), wadMul(yearsWad, _bipsToSignedWads(rate))));
    }

    /**
     * @notice Computes the next installment number based on the provided parameters.
     *
     * @param startTime The timestamp when the installment plan starts.
     * @param period The duration of each installment period.
     * @param cureOnly Boolean indicating if only cure installments should be considered.
     * @param installment The current installment number.
     *
     * @return The next installment number based on the provided parameters and the current timestamp.
     *
     * @dev The function calculates next installment based on the start time, installment period, and current timestamp
     * It considers whether only cure installments should be considered or both cure and regular installments.
     * The next installment is determined by comparing the current timestamp with the scheduled payment dates.
     * If the current timestamp is beyond the scheduled payment date, it increments the installment number accordingly.
     */
    function computeNextInstallment(
        uint256 startTime,
        uint256 period,
        bool cureOnly,
        uint256 installment
    ) external view returns (uint256) {
        uint256 paidThrough = startTime + (installment * period);
        if (block.timestamp > paidThrough + period) return cureOnly ? installment + 1 : installment + 2;
        return installment + 1;
    }

    /// @dev Converts an integer bips value to a signed wad value.
    function _bipsToSignedWads(uint256 bips) internal pure returns (int256) {
        return int256((bips * 1e18) / _BASIS_POINTS);
    }
}
