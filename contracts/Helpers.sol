// SPDX-License-Identifier: Skillet Group - LLC
pragma solidity 0.8.20;

import { RefinanceTranche } from "./Structs.sol";

library Helpers {
    function createTranches(
        uint256 principal,
        address principalRecipient,
        uint256 interest,
        address interestRecipient,
        uint256 fee,
        address feeRecipient
    ) external pure returns (RefinanceTranche[3] memory) {
        RefinanceTranche[3] memory tranches;

        // Create an array of structs to store the amounts and recipients
        RefinanceTranche[3] memory amountsAndRecipients = [
            RefinanceTranche(principal, principalRecipient),
            RefinanceTranche(interest, interestRecipient),
            RefinanceTranche(fee, feeRecipient)
        ];

        // Sort the array in descending order based on amounts
        sortAmounts(amountsAndRecipients);

        // Assign values to tranches
        for (uint256 i = 0; i < 3; i++) {
            tranches[i] = amountsAndRecipients[i];
        }

        return tranches;
    }

    function sortAmounts(RefinanceTranche[3] memory arr) internal pure {
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (arr[i].amount < arr[j].amount) {
                    (arr[i], arr[j]) = (arr[j], arr[i]);
                }
            }
        }
    }
}
